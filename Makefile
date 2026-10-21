PY_PACKAGES = api eval ml

.PHONY: install test lint api

install:
	python -m pip install -e "api[dev]" -e "eval[dev]" -e "ml[dev]"

test:
	python -m pytest api/tests -q
	python -m pytest eval/tests -q
	python -m pytest ml/tests -q

lint:
	python -m ruff check $(PY_PACKAGES)
	python -m ruff format --check $(PY_PACKAGES)

api:
	python -m uvicorn whereabout_api.main:app --reload --app-dir api/src

.PHONY: web-install web-dev web-test web-e2e
web-install:
	cd web && npm ci

web-dev:
	cd web && npm run dev

web-test:
	cd web && npm run lint && npm test && npm run build && npm run check-bundle && npm run typecheck

# Plays real games in Chromium against the static export (needs `npx playwright install chromium`).
web-e2e:
	cd web && NEXT_PUBLIC_BASE_PATH=/whereabout npm run build && npm run e2e
