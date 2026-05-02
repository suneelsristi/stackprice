## What does this PR do?

<!-- Brief description of the change -->

## Type of change

- [ ] New resource handler (`AWS::Service::Resource`)
- [ ] Bug fix
- [ ] New feature / command
- [ ] Documentation update
- [ ] Dependency update
- [ ] Refactor / cleanup

## Checklist

- [ ] `npm test` passes with zero failures
- [ ] `npm run build` exits clean
- [ ] `npm run lint` exits clean
- [ ] New handler files have 100% coverage
- [ ] No `console.log()` in `src/`
- [ ] No real AWS API calls in tests

## For new handlers only

- [ ] Pricing API values verified with live `aws pricing get-products` queries
- [ ] Hardcoded pricing values include verification comment with date and AWS pricing URL
- [ ] Handler registered in `src/cli/parser.ts`
- [ ] Usage-based handlers added to `usage-calculator.ts` and `usage-file-generator.ts`
- [ ] Usage-based handlers added to `usage-file-generator.ts` TYPE_MAP

## Related issues

<!-- Closes #123 -->
