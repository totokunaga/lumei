// Generates the API client from the backend's OpenAPI spec. Run with `bun run generate:api`.
export default {
  lumei: {
    input: '../backend/api/index.yaml',
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      clean: true,
      override: {
        mutator: {
          path: 'src/api/client.ts',
          name: 'apiFetch',
        },
      },
    },
  },
};
