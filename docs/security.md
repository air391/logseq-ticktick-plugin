# CI secret handling

- The real Dida API test reads the access token only from the GitHub Actions secret `DIDA_ACCESS_TOKEN`.
- The token is never committed to the repository.
- Workflow logs must not print the full token.
- Temporary test tasks are uniquely named with the GitHub run ID and are deleted during the workflow.
- Real API tests are intended to run only in trusted repository workflows, not in untrusted fork pull-request contexts with secrets exposed.
