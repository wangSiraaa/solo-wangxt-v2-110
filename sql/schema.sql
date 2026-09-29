-- 栏目改版链接迁移：旧/新映射、爬取结果、歧义检测、迁移方案、发布就绪
-- 所有 URL 以文本原样保存；canonical_key 由 WHATWG URL 规范化器生成（见 server/lib/normalize.js）

CREATE TABLE IF NOT EXISTS url_mappings (
    id              BIGSERIAL PRIMARY KEY,
    raw_old_url     TEXT NOT NULL,                 -- 代表形态的原始旧址（原样保存，不做隐式解码）
    raw_variants    TEXT[] NOT NULL DEFAULT '{}',  -- 同资源键的其它原始形态（如不同 fragment），仅供评审
    canonical_key   TEXT NOT NULL,                 -- WHATWG 规范化后的资源身份键（不含 fragment）
    old_origin      TEXT NOT NULL,                 -- scheme://host:port
    old_path        TEXT NOT NULL,                 -- WHATWG pathname（字节保真）
    old_query       TEXT NOT NULL DEFAULT '',      -- 原样查询串（含前导 ?；追踪参数保留）
    decision        TEXT NOT NULL DEFAULT 'REDIRECT_301'
                       CHECK (decision IN ('REDIRECT_301','GONE_410','UNMAPPED')),
    target_new_url  TEXT,                          -- decision=REDIRECT_301 时必填
    section_old     TEXT,                          -- 旧栏目
    section_new     TEXT,                          -- 新栏目
    note            TEXT,
    crawl_source    TEXT NOT NULL DEFAULT 'sitemap',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 同一资源键可以登记“互相冲突的裁决”（用于歧义检测），但相同 (键,裁决,目标) 不重复
CREATE UNIQUE INDEX IF NOT EXISTS uq_url_mappings_key_decision_target
    ON url_mappings (canonical_key, decision, COALESCE(target_new_url, ''));

-- 一次验证运行（可重复执行，历史留痕）
CREATE TABLE IF NOT EXISTS verification_runs (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    total_count     INTEGER NOT NULL DEFAULT 0,
    blocked_count   INTEGER NOT NULL DEFAULT 0,    -- 触发越权（非随项目启动站点）而被拦截
    passed_count    INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    ambiguous_count INTEGER NOT NULL DEFAULT 0,
    summary         TEXT
);

-- 每条映射的最新验证证据（每次运行重新记录）
CREATE TABLE IF NOT EXISTS crawl_results (
    id                BIGSERIAL PRIMARY KEY,
    mapping_id        BIGINT NOT NULL REFERENCES url_mappings(id) ON DELETE CASCADE,
    run_id            BIGINT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
    final_url         TEXT,                        -- 链尾最终落点
    final_status      INTEGER,                     -- 链尾 HTTP 状态（必须核实）
    chain             JSONB NOT NULL DEFAULT '[]'  -- [{hop,url,status,location}]
                      CHECK (jsonb_typeof(chain) = 'array'),
    hop_count         INTEGER NOT NULL DEFAULT 0,
    outcome           TEXT NOT NULL
                        CHECK (outcome IN ('PASS','FAIL')),
    issue_codes       TEXT[] NOT NULL DEFAULT '{}',
    issue_detail      TEXT,
    query_preserved   BOOLEAN,                     -- 查询参数/追踪参数是否端到端保留
    case_mismatch     BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_by_policy BOOLEAN NOT NULL DEFAULT FALSE, -- 指向了不允许访问的站点
    checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crawl_results_run ON crawl_results(run_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_mapping ON crawl_results(mapping_id);

-- 归一化歧义：多旧址在同一身份键下冲突，或大小写/编码形态差异需要人判
CREATE TABLE IF NOT EXISTS ambiguities (
    id                BIGSERIAL PRIMARY KEY,
    kind              TEXT NOT NULL
                        CHECK (kind IN ('CASE_VARIANT','ENCODING_VARIANT','CONFLICT','TRAILING_SLASH','QUERY_VARIANT')),
    severity          TEXT NOT NULL CHECK (severity IN ('BLOCKER','WARNING')),
    canonical_key     TEXT NOT NULL,
    candidate_urls    TEXT[] NOT NULL,
    candidate_targets TEXT[] NOT NULL DEFAULT '{}',
    detail            TEXT NOT NULL,
    resolved          BOOLEAN NOT NULL DEFAULT FALSE,
    resolution        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ambiguities_unresolved ON ambiguities(resolved) WHERE resolved = false;

-- 迁移方案：人工逐条裁决 + 发布闸门状态
CREATE TABLE IF NOT EXISTS migration_plan (
    id              BIGSERIAL PRIMARY KEY,
    mapping_id      BIGINT NOT NULL UNIQUE REFERENCES url_mappings(id) ON DELETE CASCADE,
    proposed_action TEXT NOT NULL
                    CHECK (proposed_action IN ('REDIRECT_301','GONE_410','KEEP_UNMAPPED_404')),
    proposed_target TEXT,
    readiness       TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (readiness IN ('PENDING','READY','BLOCKED','CONFIRMED_GONE')),
    block_reasons   TEXT[] NOT NULL DEFAULT '{}',
    evidence_run_id BIGINT REFERENCES verification_runs(id),
    reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
INSERT INTO schema_meta(k,v) VALUES ('schema_version','1')
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
