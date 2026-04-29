.PHONY: dev-infra dev-up dev-down db-migrate

dev-infra:
	docker compose up -d postgres redis minio

dev-up:
	docker compose up -d

dev-down:
	docker compose down

db-migrate:
	pnpm db:migrate
