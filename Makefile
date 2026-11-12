SHELL := /bin/sh
.DEFAULT_GOAL := help
.PHONY: frontend-setup frontend-dev frontend-check frontend-build test release help
node_modules/.package-lock.json: package.json package-lock.json
	npm ci
frontend-setup: node_modules/.package-lock.json
frontend-dev: frontend-setup
	npm run dev
frontend-check: frontend-setup
	npm run check
frontend-build: frontend-setup
	npm run build
test: frontend-setup
	npm test
release: frontend-check test
	python3 scripts/package-release.py
help:
	@printf '%s\n' 'frontend-setup frontend-dev frontend-check frontend-build test release'
