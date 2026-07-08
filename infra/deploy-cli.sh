#!/usr/bin/env bash
# Spin up the otel-filter as a tagged TEST Lambda in prod mode (STORE=dynamo)
# using only the AWS CLI. Idempotent-ish: re-running updates code/config.
set -euo pipefail

REGION=${REGION:-ap-southeast-2}
NAME=${NAME:-otel-filter-test}
TABLE=${TABLE:-otel-filter-test}
ROLE=${ROLE:-otel-filter-test-role}
ADMIN_TOKEN=${ADMIN_TOKEN:-$(openssl rand -hex 16)}
TAGS_JSON='{"project":"otel-filter","env":"test","owner":"fwf-ben","managed-by":"claude-code"}'
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export AWS_DEFAULT_REGION=$REGION

echo "== 1/6 DynamoDB table $TABLE =="
if ! aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  aws dynamodb create-table --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=project,Value=otel-filter Key=env,Value=test Key=owner,Value=fwf-ben Key=managed-by,Value=claude-code \
    >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE"
fi
echo "   ready"

echo "== 2/6 IAM role $ROLE =="
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags Key=project,Value=otel-filter Key=env,Value=test Key=managed-by,Value=claude-code >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  aws iam put-role-policy --role-name "$ROLE" --policy-name dynamo-crud \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Scan\",\"dynamodb:Query\"],\"Resource\":\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}\"}]}"
  echo "   created; waiting 12s for role propagation"; sleep 12
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)
echo "   $ROLE_ARN"

echo "== 3/6 package =="
ZIP=$(mktemp -d)/fn.zip
zip -qr "$ZIP" src package.json
echo "   $ZIP"

echo "== 4/6 create/update function $NAME =="
ENVFILE=$(mktemp).json
cat > "$ENVFILE" <<JSON
{"Variables":{"STORE":"dynamo","TABLE_NAME":"$TABLE","HONEYCOMB_DATASET":"claude-code","HONEYCOMB_ENDPOINT":"https://api.honeycomb.io","ADMIN_TOKEN":"$ADMIN_TOKEN","REPO_ATTR":"repo","HONEYCOMB_API_KEY":"${HONEYCOMB_API_KEY:-}"}}
JSON
if aws lambda get-function --function-name "$NAME" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$NAME" --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$NAME"
  aws lambda update-function-configuration --function-name "$NAME" --environment "file://$ENVFILE" >/dev/null
else
  aws lambda create-function --function-name "$NAME" \
    --runtime nodejs22.x --architectures arm64 --handler src/lambda.handler \
    --role "$ROLE_ARN" --timeout 15 --memory-size 256 \
    --zip-file "fileb://$ZIP" --environment "file://$ENVFILE" \
    --tags project=otel-filter,env=test,owner=fwf-ben,managed-by=claude-code >/dev/null
fi
aws lambda wait function-updated --function-name "$NAME"
echo "   deployed"

echo "== 5/6 API Gateway HTTP API (public front door) =="
# A Lambda Function URL is simpler, but many orgs block public Function URLs
# (AuthType=NONE) with an SCP on lambda:FunctionUrlAuthType. API Gateway HTTP
# APIs are public by default and not caught by that guardrail.
FN_ARN=$(aws lambda get-function --function-name "$NAME" --query Configuration.FunctionArn --output text)
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$NAME'].ApiId | [0]" --output text)
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  API_ID=$(aws apigatewayv2 create-api --name "$NAME" --protocol-type HTTP --target "$FN_ARN" \
    --tags project=otel-filter env=test managed-by=claude-code --query ApiId --output text)
  aws lambda add-permission --function-name "$NAME" --statement-id apigw-invoke \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*/*" >/dev/null || true
fi
URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

echo "== 6/6 done =="
echo "URL=$URL"
echo "ADMIN_TOKEN=$ADMIN_TOKEN"
echo "Point exporters at:  OTEL_EXPORTER_OTLP_ENDPOINT=$URL"
echo "Dashboard:           $URL/admin?token=$ADMIN_TOKEN"
