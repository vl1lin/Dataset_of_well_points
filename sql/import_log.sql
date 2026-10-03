SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'fields'
ORDER BY ordinal_position;

SELECT * FROM fields;

-- Создание временной таблицы для импорта данных из 2-го файла csv

CREATE TABLE stg_fluid(
field_code        TEXT,
    horizon           TEXT,
    t_res_c           TEXT,
    rho_oil_res       TEXT,
    rho_oil_dead      TEXT,
    p_sat_mpa         TEXT,
    gas_content_m3m3  TEXT,
    b_oil             TEXT,
    mu_oil_res_mpas   TEXT,
    mu_oil_dead_mpas  TEXT,
    rho_gas           TEXT,
    y_methane_pct     TEXT,
    y_nitrogen_pct    TEXT,
    rho_water         TEXT,
    source            TEXT,
    note              TEXT
);

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'stg_fluid'
ORDER BY ordinal_position;

SELECT * FROM stg_fluid LIMIT 5;

CREATE TABLE fluids (
    fluid_id            SERIAL PRIMARY KEY,
    field_id            INT  NOT NULL REFERENCES fields(id),
    horizon             TEXT,                  -- залежь/горизонт: 'D', 'PC', 'DI, DII'
    t_res_c             NUMERIC,               -- t_пл, °C
    rho_oil_res         NUMERIC,               -- ρ_н пл, кг/м3
    rho_oil_dead        NUMERIC,               -- ρ_н дег, кг/м3
    p_sat_mpa           NUMERIC,               -- P_нас, МПа
    gas_content_m3m3    NUMERIC,               -- G_o, м3/м3
    gas_saturation_m3t  NUMERIC,               -- Г_м, м3/т
    b_oil               NUMERIC,               -- объёмный коэффициент b_н
    mu_oil_res_mpas     NUMERIC,               -- вязкость пластовой нефти, мПа·с
    rho_gas             NUMERIC,               -- ρ_г, кг/м3
    y_methane_pct       NUMERIC,               -- y_м, %
    y_nitrogen_pct      NUMERIC,               -- y_a, %
    rho_water           NUMERIC,               -- ρ_в, кг/м3
    note                TEXT,                  -- диапазоны и всё, что не влезло в колонки
    UNIQUE (field_id, horizon)
);

ALTER TABLE fluids ADD COLUMN source TEXT;
ALTER TABLE fluids ADD COLUMN mu_oil_dead_mpas NUMERIC;

INSERT INTO fluids (
field_id,
    horizon,
    t_res_c,
    rho_oil_res,
    rho_oil_dead,
    p_sat_mpa,
    gas_content_m3m3,
    b_oil,
    mu_oil_res_mpas,
	mu_oil_dead_mpas,
    rho_gas,
    y_methane_pct,
    y_nitrogen_pct,
    rho_water,
    source,
    note
)
SELECT f.id,
       s.horizon,
       s.t_res_c::numeric,
       s.rho_oil_res::numeric,
       s.rho_oil_dead::NUMERIC,               -- ρ_н дег, кг/м3
    s.p_sat_mpa::NUMERIC,               -- P_нас, МПа
    s.gas_content_m3m3::NUMERIC,               -- G_o, м3/м3
    s.b_oil::NUMERIC,               -- объёмный коэффициент b_н
    s.mu_oil_res_mpas::NUMERIC,
	s.mu_oil_dead_mpas::NUMERIC,
    s.rho_gas::NUMERIC,               -- ρ_г, кг/м3
    s.y_methane_pct::NUMERIC,               -- y_м, %
    s.y_nitrogen_pct::NUMERIC,               -- y_a, %
    s.rho_water::NUMERIC,
	s.source,
    s.note
FROM stg_fluid s
JOIN fields f ON f.code = s.field_code;

SELECT * FROM fluids LIMIT 5;

BEGIN;

-- 1. Переименование существующих колонок под имена из CSV
ALTER TABLE studies RENAME COLUMN code        TO study_code;
ALTER TABLE studies RENAME COLUMN q_liq_t_day TO q_liquid;      -- единица теперь в q_liquid_unit
ALTER TABLE studies RENAME COLUMN wc_mass_pct TO water_cut_pct; -- тип теперь в water_cut_type

-- 2. Дата → год + месяц
ALTER TABLE studies DROP COLUMN study_date;

-- 3. Добавление недостающих колонок (порядок как в CSV)
ALTER TABLE studies
    ADD COLUMN horizon               TEXT,
    ADD COLUMN lift_method           TEXT,
    ADD COLUMN study_year            INT,
    ADD COLUMN study_month           INT,
    ADD COLUMN measured_in           TEXT,
    ADD COLUMN q_liquid_unit         TEXT,
    ADD COLUMN q_oil                 NUMERIC,
    ADD COLUMN q_oil_unit            TEXT,
    ADD COLUMN q_water               NUMERIC,
    ADD COLUMN q_water_unit          TEXT,
    ADD COLUMN water_cut_type        TEXT,
    ADD COLUMN d_out_m               NUMERIC,
    ADD COLUMN casing_d_in_m         NUMERIC,
    ADD COLUMN choke_mm              NUMERIC,
    ADD COLUMN h_well_m              NUMERIC,
    ADD COLUMN h_pump_m              NUMERIC,
    ADD COLUMN h_gas_inj_m           NUMERIC,
    ADD COLUMN h_dyn_m               NUMERIC,
    ADD COLUMN perf_top_m            NUMERIC,
    ADD COLUMN perf_bottom_m         NUMERIC,
    ADD COLUMN incl_deg              NUMERIC,
    ADD COLUMN p_res_mpa             NUMERIC,
    ADD COLUMN p_bh_mpa              NUMERIC,
    ADD COLUMN p_wh_mpa              NUMERIC,
    ADD COLUMN p_annulus_mpa         NUMERIC,
    ADD COLUMN p_intake_mpa          NUMERIC,
    ADD COLUMN p_sat_mpa             NUMERIC,
    ADD COLUMN p_discharge_mpa       NUMERIC,
    ADD COLUMN t_wh_c                NUMERIC,
    ADD COLUMN t_bh_c                NUMERIC,
    ADD COLUMN t_res_c               NUMERIC,
    ADD COLUMN gas_total_m3d         NUMERIC,
    ADD COLUMN gas_annulus_m3d       NUMERIC,
    ADD COLUMN gas_annulus_spec_m3m3 NUMERIC,
    ADD COLUMN v_bubble_cms          NUMERIC,
    ADD COLUMN gor                   NUMERIC,
    ADD COLUMN gor_unit              TEXT,
    ADD COLUMN gas_content_m3m3      NUMERIC,
    ADD COLUMN gas_sat_m3t           NUMERIC,
    ADD COLUMN rho_water             NUMERIC,
    ADD COLUMN rho_oil_dead          NUMERIC,
    ADD COLUMN rho_oil_res           NUMERIC,
    ADD COLUMN rho_gas               NUMERIC,
    ADD COLUMN pump_model            TEXT,
    ADD COLUMN note                  TEXT;

-- 4. Проверки допустимых значений (списки взяты из самого CSV)
ALTER TABLE studies
    ADD CONSTRAINT chk_month       CHECK (study_month BETWEEN 1 AND 12),
    ADD CONSTRAINT chk_q_liq_unit  CHECK (q_liquid_unit IN ('т/сут','м3/сут')),
    ADD CONSTRAINT chk_q_oil_unit  CHECK (q_oil_unit    IN ('т/сут','м3/сут')),
    ADD CONSTRAINT chk_q_wat_unit  CHECK (q_water_unit  IN ('т/сут','м3/сут')),
    ADD CONSTRAINT chk_wc_type     CHECK (water_cut_type IN ('массовая','объемная')),
    ADD CONSTRAINT chk_gor_unit    CHECK (gor_unit IN ('м3/т','м3/м3')),
    ADD CONSTRAINT chk_measured_in CHECK (measured_in IN ('НКТ','затруб','обсадная колонна')),
    ADD CONSTRAINT chk_lift        CHECK (lift_method IN ('фонтан','газлифт','ЭЦН','ЭВН','ШСН'));

COMMIT;

CREATE TABLE stg_studies (
    field_code            TEXT,
    study_code            TEXT,
    well                  TEXT,
    horizon               TEXT,
    lift_method           TEXT,
    study_year            INT,
    study_month           INT,
    measured_in           TEXT,
    q_liquid              NUMERIC,
    q_liquid_unit         TEXT,
    q_oil                 NUMERIC,
    q_oil_unit            TEXT,
    q_water               NUMERIC,
    q_water_unit          TEXT,
    water_cut_pct         NUMERIC,
    water_cut_type        TEXT,
    d_in_m                NUMERIC,
    d_out_m               NUMERIC,
    casing_d_in_m         NUMERIC,
    choke_mm              NUMERIC,
    h_well_m              NUMERIC,
    h_tubing_m            NUMERIC,
    h_pump_m              NUMERIC,
    h_gas_inj_m           NUMERIC,
    h_dyn_m               NUMERIC,
    perf_top_m            NUMERIC,
    perf_bottom_m         NUMERIC,
    incl_deg              NUMERIC,
    p_res_mpa             NUMERIC,
    p_bh_mpa              NUMERIC,
    p_wh_mpa              NUMERIC,
    p_annulus_mpa         NUMERIC,
    p_intake_mpa          NUMERIC,
    p_sat_mpa             NUMERIC,
    p_discharge_mpa       NUMERIC,
    t_wh_c                NUMERIC,
    t_bh_c                NUMERIC,
    t_res_c               NUMERIC,
    gas_total_m3d         NUMERIC,
    gas_annulus_m3d       NUMERIC,
    gas_annulus_spec_m3m3 NUMERIC,
    v_bubble_cms          NUMERIC,
    gor                   NUMERIC,
    gor_unit              TEXT,
    gas_content_m3m3      NUMERIC,
    gas_sat_m3t           NUMERIC,
    rho_water             NUMERIC,
    rho_oil_dead          NUMERIC,
    rho_oil_res           NUMERIC,
    rho_gas               NUMERIC,
    pump_model            TEXT,
    note                  TEXT
);

SELECT DISTINCT s.field_code
FROM stg_studies s
LEFT JOIN fields f ON f.code = s.field_code
WHERE f.id IS NULL;

BEGIN;

INSERT INTO studies (
    field_id, study_code, well, horizon, lift_method, study_year, study_month, measured_in,
    q_liquid, q_liquid_unit, q_oil, q_oil_unit, q_water, q_water_unit, water_cut_pct, water_cut_type,
    d_in_m, d_out_m, casing_d_in_m, choke_mm, h_well_m, h_tubing_m, h_pump_m, h_gas_inj_m, h_dyn_m,
    perf_top_m, perf_bottom_m, incl_deg,
    p_res_mpa, p_bh_mpa, p_wh_mpa, p_annulus_mpa, p_intake_mpa, p_sat_mpa, p_discharge_mpa,
    t_wh_c, t_bh_c, t_res_c,
    gas_total_m3d, gas_annulus_m3d, gas_annulus_spec_m3m3, v_bubble_cms, gor, gor_unit,
    gas_content_m3m3, gas_sat_m3t, rho_water, rho_oil_dead, rho_oil_res, rho_gas, pump_model, note
)
SELECT
    f.id,                                        -- ← вместо field_code берём id месторождения
    s.study_code, s.well, s.horizon, s.lift_method, s.study_year, s.study_month, s.measured_in,
    s.q_liquid, s.q_liquid_unit, s.q_oil, s.q_oil_unit, s.q_water, s.q_water_unit, s.water_cut_pct, s.water_cut_type,
    s.d_in_m, s.d_out_m, s.casing_d_in_m, s.choke_mm, s.h_well_m, s.h_tubing_m, s.h_pump_m, s.h_gas_inj_m, s.h_dyn_m,
    s.perf_top_m, s.perf_bottom_m, s.incl_deg,
    s.p_res_mpa, s.p_bh_mpa, s.p_wh_mpa, s.p_annulus_mpa, s.p_intake_mpa, s.p_sat_mpa, s.p_discharge_mpa,
    s.t_wh_c, s.t_bh_c, s.t_res_c,
    s.gas_total_m3d, s.gas_annulus_m3d, s.gas_annulus_spec_m3m3, s.v_bubble_cms, s.gor, s.gor_unit,
    s.gas_content_m3m3, s.gas_sat_m3t, s.rho_water, s.rho_oil_dead, s.rho_oil_res, s.rho_gas, s.pump_model, s.note
FROM stg_studies s
JOIN fields f ON f.code = s.field_code;          -- ←

SELECT COUNT(*) FROM studies;

COMMIT;


ALTER TABLE points
    ADD CONSTRAINT uq_points_study_depth UNIQUE (study_id, depth_m),
    ADD CONSTRAINT fk_points_study FOREIGN KEY (study_id) REFERENCES studies(id);


CREATE TABLE stg_points (
    study_code    TEXT,
    depth_m       NUMERIC,
    pressure_mpa  NUMERIC,
    temp_c        NUMERIC
);

SELECT DISTINCT p.study_code
FROM stg_points p
LEFT JOIN studies s ON s.study_code = p.study_code
WHERE s.id IS NULL;

BEGIN;
INSERT INTO points (study_id, depth_m, pressure_mpa, temp_c)
SELECT s.id, p.depth_m, p.pressure_mpa, p.temp_c
FROM stg_points p
JOIN studies s ON s.study_code = p.study_code;

SELECT COUNT(*) AS rows_in_points FROM points;
COMMIT;

begin;
CREATE TABLE pump_intake (
    id                SERIAL PRIMARY KEY,
    field_id          INT  NOT NULL REFERENCES fields(id),   -- ←
    fluid_id          INT  REFERENCES fluids(fluid_id),
    well              TEXT NOT NULL,           -- '1Э', '8Ш'
    lift_method       TEXT,                    -- 'ЭЦН' / 'ШСН'
    regime            INT  NOT NULL,           -- номер режима: 1, 2, 3...
    h_pump_m          NUMERIC,                 -- H_спн, м
    h_dyn_m           NUMERIC,                 -- H_дин, м
    p_annulus_wh_mpa  NUMERIC,                 -- P_зу, МПа
    p_intake_mpa      NUMERIC,                 -- P_прэ, МПа (замер)
    book_table        TEXT,                    -- 'Таблица 2.1'
    note              TEXT,

    CONSTRAINT chk_pi_lift   CHECK (lift_method IN ('ЭЦН','ШСН')),
    CONSTRAINT chk_pi_regime CHECK (regime > 0),
    CONSTRAINT uq_pi_well_regime UNIQUE (field_id, well, regime)
);

CREATE TABLE stg_pump_intake (
    field_code        TEXT,
    fluid_horizon     TEXT,
    well              TEXT,
    lift_method       TEXT,
    regime            INT,
    h_pump_m          NUMERIC,
    h_dyn_m           NUMERIC,
    p_annulus_wh_mpa  NUMERIC,
    p_intake_mpa      NUMERIC,
    book_table        TEXT,
    note              TEXT
);
commit;


SELECT DISTINCT s.field_code, s.fluid_horizon,
       f.id  AS field_found,
       fl.fluid_id AS fluid_found
FROM stg_pump_intake s
LEFT JOIN fields f  ON f.code = s.field_code                       -- ←
LEFT JOIN fluids fl ON fl.field_id = f.id
                   AND fl.horizon  = s.fluid_horizon               -- ←
WHERE f.id IS NULL OR fl.fluid_id IS NULL;

begin;
INSERT INTO pump_intake (                                          -- ←
    field_id, fluid_id, well, lift_method, regime,
    h_pump_m, h_dyn_m, p_annulus_wh_mpa, p_intake_mpa, book_table, note
)
SELECT f.id, fl.fluid_id, s.well, s.lift_method, s.regime,
       s.h_pump_m, s.h_dyn_m, s.p_annulus_wh_mpa, s.p_intake_mpa, s.book_table, s.note
FROM stg_pump_intake s
JOIN fields f  ON f.code = s.field_code
JOIN fluids fl ON fl.field_id = f.id
              AND fl.horizon  = s.fluid_horizon;

SELECT COUNT(*) AS rows_in_pump_intake FROM pump_intake;   -- ожидаем 107

commit;

DROP TABLE IF EXISTS stg_studies, stg_points, stg_pump_intake, stg_fluid;

SELECT 'fields'      AS table_name, COUNT(*) FROM fields
UNION ALL SELECT 'fluids',      COUNT(*) FROM fluids
UNION ALL SELECT 'studies',     COUNT(*) FROM studies
UNION ALL SELECT 'points',      COUNT(*) FROM points
UNION ALL SELECT 'pump_intake', COUNT(*) FROM pump_intake;

VACUUM ANALYZE;

ALTER TABLE fields      OWNER TO well_user;
ALTER TABLE fluids      OWNER TO well_user;
ALTER TABLE studies     OWNER TO well_user;
ALTER TABLE points      OWNER TO well_user;
ALTER TABLE pump_intake OWNER TO well_user;
ALTER DATABASE well_points_dataset OWNER TO well_user;

SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';