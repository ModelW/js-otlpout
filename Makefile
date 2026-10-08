# WITH code-formatting guideline: `make format` reformats everything.
# See https://with-codeguidelines.readthedocs-hosted.com/en/latest/code-formatting.html

.PHONY: help format lint typecheck test test-sveltekit build

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

format: ## Reformat every file (prettier)
	pnpm exec prettier --write .

lint: ## Check formatting (prettier) and lint (eslint)
	pnpm run lint

typecheck: ## Type-check with tsc
	pnpm exec tsc --noEmit

test: ## Run the library test suite (vitest)
	pnpm exec vitest run

test-sveltekit: ## Run the real SvelteKit toy-app e2e test
	pnpm --filter sveltekit-pet test

build: ## Build the package (tsup)
	pnpm run build
