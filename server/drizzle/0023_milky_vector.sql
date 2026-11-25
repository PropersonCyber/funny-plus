CREATE TABLE "data_version" (
	"id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 单行计数器：AI 引擎靠它判断库里的数据变没变（见 src/data/dataVersion.ts）
INSERT INTO "data_version" ("id", "version") VALUES ('global', 1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- 触发器负责增、改、删都推进版本号。
-- 为什么不靠各表的 max(updated_at)：删掉一条非最新记录、或手动 UPDATE 没写 updated_at 时，
-- 最大值都不变，AI 侧就会一直用旧数据，而且没有任何报错。
CREATE OR REPLACE FUNCTION bump_data_version() RETURNS trigger AS $$
BEGIN
	UPDATE "data_version" SET "version" = "version" + 1, "updated_at" = now() WHERE "id" = 'global';
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- FOR EACH STATEMENT：批量改写只推一次，省得一次迁移把计数器刷成几万
CREATE TRIGGER "places_data_version" AFTER INSERT OR UPDATE OR DELETE ON "places"
	FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
CREATE TRIGGER "lines_data_version" AFTER INSERT OR UPDATE OR DELETE ON "lines"
	FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
CREATE TRIGGER "field_evidence_data_version" AFTER INSERT OR UPDATE OR DELETE ON "field_evidence"
	FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
