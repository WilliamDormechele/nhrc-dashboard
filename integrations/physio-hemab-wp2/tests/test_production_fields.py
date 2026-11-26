import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from production_fields import select_fields, diary_metrics

def field(name, kind, choices="", form="activity_diary"):
    return {"field_name": name, "field_type": kind, "select_choices_or_calculations": choices, "form_name": form}

class ProductionFieldsTests(unittest.TestCase):
    def test_new_choices_are_labels_not_raw_codes(self):
        fields = {"ad_call_number": field("ad_call_number", "radio", "0, 1 | 1, 2 | 2, 3"), "ad_dc_interview": field("ad_dc_interview", "radio", "1, Phone | 2, In person")}
        self.assertEqual(diary_metrics({"ad_call_number":"0","ad_dc_interview":"2"},fields), {"dashboard_calls_made":1,"dashboard_interview_type":"In person"})
    def test_blank_and_ambiguous_do_not_become_zero(self):
        fields={"ad_call_number":field("ad_call_number","checkbox","0, 1 | 1, 2")}
        self.assertIsNone(diary_metrics({},fields)["dashboard_calls_made"])
        self.assertIsNone(diary_metrics({"ad_call_number___0":"1","ad_call_number___1":"1"},fields)["dashboard_calls_made"])
        self.assertEqual(diary_metrics({"ad_call_number___0":"1"},fields)["dashboard_calls_made"],1)
    def test_legacy_fallback_only_when_new_unanswered(self):
        fields={"ad_call_number":field("ad_call_number","radio","0, 1 | 1, 3 or more"),"ad_call_numb":field("ad_call_numb","radio","0, 1 | 1, 2")}
        self.assertEqual(diary_metrics({"ad_call_numb":"1"},fields)["dashboard_calls_made"],2)
        self.assertIsNone(diary_metrics({"ad_call_number":"1","ad_call_numb":"1"},fields)["dashboard_calls_made"])
    def test_deleted_legacy_field_not_requested_and_completion_preserved(self):
        metadata=[field("ad_call_number","radio","0, 1")]
        self.assertEqual(select_fields("main",["ad_call_numb","ad_call_number","activity_diary_complete"],metadata),["ad_call_number","activity_diary_complete"])
        with self.assertRaises(RuntimeError):
            select_fields("main",["enrollment_form_complete","ad_call_number"],metadata)

if __name__ == "__main__":
    unittest.main()
