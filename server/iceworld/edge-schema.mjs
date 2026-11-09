import { Validator } from '@cfworker/json-schema'
import schema from 'ajv/dist/refs/json-schema-2020-12/schema.json' with { type: 'json' }
import core from 'ajv/dist/refs/json-schema-2020-12/meta/core.json' with { type: 'json' }
import applicator from 'ajv/dist/refs/json-schema-2020-12/meta/applicator.json' with { type: 'json' }
import unevaluated from 'ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json' with { type: 'json' }
import validation from 'ajv/dist/refs/json-schema-2020-12/meta/validation.json' with { type: 'json' }
import metadata from 'ajv/dist/refs/json-schema-2020-12/meta/meta-data.json' with { type: 'json' }
import format from 'ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json' with { type: 'json' }
import content from 'ajv/dist/refs/json-schema-2020-12/meta/content.json' with { type: 'json' }

const metaschema = new Validator(schema, '2020-12')
for (const vocabulary of [core, applicator, unevaluated, validation, metadata, format, content]) {
  metaschema.addSchema(vocabulary)
}

const paths = errors => errors.map(({ keyword, instanceLocation, keywordLocation }) => ({
  keyword, instancePath: instanceLocation, schemaPath: keywordLocation,
}))

/** Interpret both the submitted schema and result without runtime code generation. */
export function compileEdgeSchema(schema) {
  const definition = metaschema.validate(schema)
  if (!definition.valid) {
    const error = new Error('Invalid schema')
    error.validation = paths(definition.errors)
    throw error
  }
  const validator = new Validator(schema, '2020-12')
  const validate = value => {
    const result = validator.validate(value)
    validate.errors = paths(result.errors)
    return result.valid
  }
  return validate
}
