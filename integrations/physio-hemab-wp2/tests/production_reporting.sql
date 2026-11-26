-- Synthetic regression fixture only; no real study records.
BEGIN;
INSERT INTO physio_hemab_wp2.redcap_metadata(source_project,field_name,choices)
VALUES
 ('main','call_date','{"0":"Yes","1":"No"}'),
 ('devices','distributed_a1','{"0":"Yes","1":"No"}'),
 ('devices','returned_a1','{"0":"Yes","1":"No"}'),
 ('devices','complete_a1','{"0":"Yes","1":"No"}'),
 ('devices','missings_a1','{"0":"Bittium + Cable","1":"Greenteg","2":"Geneactive","3":"Switchbot","4":"URGREEN"}');

INSERT INTO physio_hemab_wp2.raw_records(source_project,record_id,repeat_instrument,repeat_instance,payload,payload_hash)
VALUES
 ('main','synthetic','','','{"enroll_studid":"synthetic","enrollment_form_complete":"2","maternal_record_book_baseline_complete":"2","physical_examination_form_complete":"1"}','synthetic1'),
 ('main','synthetic','activity_diary','1','{"ad_date":"2026-11-26","call_date":"0","dashboard_calls_made":2,"dashboard_interview_type":"Phone","activity_diary_complete":"2"}','synthetic2'),
 ('devices','synthetic','','','{"devices_date":"2026-11-25","return_date":"2026-11-26","distributed_a1":"0","returned_a1":"0","complete_a1":"1","missings_a1___2":"1"}','synthetic3');

DO $$
BEGIN
 IF (SELECT count(*) FROM physio_hemab_wp2.vw_participants WHERE enrollment_complete AND maternal_record_book_complete AND NOT physical_examination_complete) <> 1 THEN
   RAISE EXCEPTION 'Completion KPI regression';
 END IF;
 IF (SELECT count(*) FROM physio_hemab_wp2.vw_activity_diaries WHERE diary_complete AND calls_made=2 AND interview_type='Phone' AND same_day_interview='Yes') <> 1 THEN
   RAISE EXCEPTION 'Revised activity diary reporting regression';
 END IF;
 IF (SELECT count(*) FROM physio_hemab_wp2.vw_device_distributions) <> 1 OR
    (SELECT count(*) FROM physio_hemab_wp2.vw_device_returns WHERE return_completeness_status='Incomplete' AND components_returned=4 AND missing_components='Geneactive') <> 1 THEN
   RAISE EXCEPTION 'Non-repeating device reporting regression';
 END IF;
 IF (SELECT count(*) FROM physio_hemab_wp2.vw_device_set_status) <> 20 THEN
   RAISE EXCEPTION 'Device inventory regression';
 END IF;
END $$;
ROLLBACK;
