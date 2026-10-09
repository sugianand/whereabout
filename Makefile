.PHONY: install test lint api

install:
	python -m pip install -e "api[dev]"

test:
	python -m pytest api/tests -q

lint:
	python -m ruff check api
	python -m ruff format --check api

api:
	python -m uvicorn whereabout_api.main:app --reload --app-dir api/src

.PHONY: web-install web-dev web-test
web-install:
	cd web && npm ci

web-dev:
	cd web && npm run dev

web-test:
	cd web && npm run lint && npm test && npm run build && npm run typecheck
