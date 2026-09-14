import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("configure", Path(__file__).parents[1] / "integration/configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class IntegrationTest(unittest.TestCase):
    def test_arbitrary_sites_render_without_source_changes(self):
        for instance, session in [("lab-one", "/api/OpenELIS-Global/session"), ("clinic_42", "/custom/context/session")]:
            with self.subTest(instance=instance):
                files = configure.render({"instance": instance, "review_origin": "https://review.example.org:8443", "session_path": session})
                submit = session.rsplit("/", 1)[0] + f"/__review/uat-{instance}/submissions"
                self.assertIn(f'location = {submit} ', files["routes.conf"])
                self.assertIn(f'data-submit-src="{submit}"', files["embed.html"])
                self.assertIn(f'proxy_pass https://review.example.org:8443/uat/{instance}/submissions;', files["routes.conf"])
                self.assertIn('proxy_set_header Cookie $http_cookie;', files["routes.conf"])
                self.assertIn('proxy_ssl_verify on;', files["routes.conf"])
                self.assertIn('proxy_ssl_name review.example.org;', files["routes.conf"])

    def test_label_cannot_inject_html_or_nginx_directives(self):
        files = configure.render({"instance": "lab", "review_origin": "https://review.example.org", "label": 'Lab "</script>\\$host'})
        self.assertIn('&quot;&lt;/script&gt;', files["embed.html"])
        self.assertIn('&#92;&#36;host', files["html.conf"])
        self.assertNotIn('$host', files["html.conf"])
        self.assertEqual(files["embed.html"].count("</script>"), 1)

    def test_general_server_can_show_all_stories_without_build_metadata(self):
        files = configure.render({"instance": "testing", "review_origin": "https://review.example.org", "story_scope": "all", "build_path": None, "suggested_stories": ["RPT-S01", "reporting--RPT-S04"]})
        self.assertIn('data-story-scope="all"', files["embed.html"])
        self.assertIn('data-build-src="none"', files["embed.html"])
        self.assertIn('data-suggested-stories="RPT-S01,reporting--RPT-S04"', files["embed.html"])
        self.assertIn('/uat/testing/submissions;', files["routes.conf"])

    def test_invalid_configuration_is_rejected_before_writing(self):
        invalid = [
            {"instance": "index"}, {"instance": "lab; return 200"},
            {"review_origin": "http://review.example.org"},
            {"review_origin": "https://user:password@review.example.org"},
            {"review_origin": "https://review.example.org/path"},
            {"session_path": "//other.example.org/session"},
            {"session_path": "/api/../session"},
            {"ca_bundle": "/tmp/ca; proxy_ssl_verify off"},
            {"label": "hello\nreturn 200"},
            {"story_scope": "invalid"},
            {"suggested_stories": "RPT-S01"},
            {"suggested_stories": ["RPT S01"]},
        ]
        for overrides in invalid:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                configure.render({"instance": "lab", "review_origin": "https://review.example.org", **overrides})


if __name__ == "__main__":
    unittest.main()
