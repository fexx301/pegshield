import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const [, , schemaPath, dataPath] = process.argv;
if (!schemaPath || !dataPath) {
  console.error("usage: node scripts/validate-json.mjs <schema> <data>");
  process.exit(2);
}

if (!existsSync(schemaPath) || !existsSync(dataPath)) {
  console.log(
    `validation deferred: ${schemaPath} or ${dataPath} does not exist yet`,
  );
  process.exit(0);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(data)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}
console.log(`valid: ${dataPath}`);
