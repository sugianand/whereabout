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
