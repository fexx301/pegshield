import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const [, , ...args] = process.argv;
const allowMissing = args.includes("--allow-missing");
const paths = args.filter((arg) => arg !== "--allow-missing");
const [schemaPath, dataPath] = paths;
if (!schemaPath || !dataPath) {
  console.error(
    "usage: node scripts/validate-json.mjs <schema> <data> [--allow-missing]",
  );
  process.exit(2);
}

// A missing schema means generation has not produced it yet; defer so
// generate-time callers stay green before the first artifact exists.
if (!existsSync(schemaPath)) {
  console.log(`validation deferred: ${schemaPath} does not exist yet`);
  process.exit(0);
}
// Committed data artifacts are required: a missing data file must fail the
// CI gates rather than silently pass. Pass --allow-missing to opt back into
// the deferred behavior for generate-time flows.
if (!existsSync(dataPath)) {
  if (allowMissing) {
    console.log(`validation deferred: ${dataPath} does not exist yet`);
    process.exit(0);
  }
  console.error(`validation failed: ${dataPath} does not exist`);
  process.exit(1);
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
