-- LabOS Track 3: Knowledge & Engineering Foundation
CREATE TABLE IF NOT EXISTS lab_findings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 experiment_id UUID REFERENCES project_experiments(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','rejected','superseded')),
 confidence NUMERIC(5,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
 tags TEXT[] NOT NULL DEFAULT '{}',
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_findings_project ON lab_findings(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_findings_experiment ON lab_findings(experiment_id);
CREATE INDEX IF NOT EXISTS idx_lab_findings_tags ON lab_findings USING GIN(tags);

CREATE TABLE IF NOT EXISTS lab_results (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 experiment_id UUID REFERENCES project_experiments(id) ON DELETE SET NULL,
 finding_id UUID REFERENCES lab_findings(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '',
 value_numeric NUMERIC,
 value_text TEXT,
 unit TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL OR summary <> '')
);
CREATE INDEX IF NOT EXISTS idx_lab_results_project ON lab_results(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_results_experiment ON lab_results(experiment_id);

CREATE TABLE IF NOT EXISTS knowledge_relationships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 source_type TEXT NOT NULL CHECK (source_type IN ('finding','result','experiment','task','note','resource','calculation')),
 source_id UUID NOT NULL,
 target_type TEXT NOT NULL CHECK (target_type IN ('finding','result','experiment','task','note','resource','calculation')),
 target_id UUID NOT NULL,
 relationship TEXT NOT NULL,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (NOT (source_type=target_type AND source_id=target_id)),
 UNIQUE(source_type, source_id, target_type, target_id, relationship)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_source ON knowledge_relationships(source_type,source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_target ON knowledge_relationships(target_type,target_id);

CREATE TABLE IF NOT EXISTS engineering_calculations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 experiment_id UUID REFERENCES project_experiments(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'general',
 formula TEXT NOT NULL,
 inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
 result_numeric NUMERIC,
 result_text TEXT,
 result_unit TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (result_numeric IS NOT NULL OR result_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_engineering_calculations_project ON engineering_calculations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engineering_calculations_experiment ON engineering_calculations(experiment_id);
CREATE INDEX IF NOT EXISTS idx_engineering_calculations_category ON engineering_calculations(category);

CREATE TABLE IF NOT EXISTS engineering_tests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 test_type TEXT NOT NULL DEFAULT 'engineering',
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','passed','failed','cancelled')),
 inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
 results JSONB NOT NULL DEFAULT '{}'::jsonb,
 conclusion TEXT NOT NULL DEFAULT '',
 performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engineering_tests_project ON engineering_tests(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS engineering_formulas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 expression TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO engineering_formulas(key,name,category,expression,description,input_schema) VALUES
 ('ohms_law','Ohm''s Law','electronics','V = I × R','Voltage from current and resistance.','{"inputs":["current_A","resistance_ohm"]}'),
 ('power_vi','DC Power','electronics','P = V × I','Power from voltage and current.','{"inputs":["voltage_V","current_A"]}'),
 ('voltage_divider','Voltage Divider','electronics','Vout = Vin × R2 / (R1 + R2)','Output voltage across the lower resistor.','{"inputs":["vin_V","r1_ohm","r2_ohm"]}'),
 ('led_resistor','LED Resistor','electronics','R = (Vs − Vf) / I','Series resistor for an LED.','{"inputs":["supply_V","forward_V","current_A"]}')
ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, expression=EXCLUDED.expression, description=EXCLUDED.description, input_schema=EXCLUDED.input_schema;

CREATE OR REPLACE FUNCTION lab_track3_touch_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lab_findings_touch ON lab_findings;
CREATE TRIGGER lab_findings_touch BEFORE UPDATE ON lab_findings FOR EACH ROW EXECUTE FUNCTION lab_track3_touch_updated_at();
DROP TRIGGER IF EXISTS lab_results_touch ON lab_results;
CREATE TRIGGER lab_results_touch BEFORE UPDATE ON lab_results FOR EACH ROW EXECUTE FUNCTION lab_track3_touch_updated_at();
DROP TRIGGER IF EXISTS engineering_calculations_touch ON engineering_calculations;
CREATE TRIGGER engineering_calculations_touch BEFORE UPDATE ON engineering_calculations FOR EACH ROW EXECUTE FUNCTION lab_track3_touch_updated_at();
DROP TRIGGER IF EXISTS engineering_tests_touch ON engineering_tests;
CREATE TRIGGER engineering_tests_touch BEFORE UPDATE ON engineering_tests FOR EACH ROW EXECUTE FUNCTION lab_track3_touch_updated_at();
