"""Company description lookup (helper/engine/company_about.py). No network."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import company_about as ca  # noqa: E402
from engine.core import EngineError  # noqa: E402


class Ctx:
    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        return await load()


class About(unittest.TestCase):
    def test_cik_and_parsing(self):
        self.assertEqual(ca.cik10(320193), '0000320193')
        with self.assertRaises(EngineError):
            ca.cik10('')
        data = {'results': {'bindings': [{'article': {'value': 'https://en.wikipedia.org/wiki/Apple_Inc.'}, 'item': {'value': 'http://www.wikidata.org/entity/Q312'}}]}}
        self.assertEqual(ca.parse_article(data), ('Apple_Inc.', 'Q312'))
        self.assertEqual(ca.parse_article({'results': {'bindings': []}}), (None, None))

    def test_trim_at_sentence(self):
        self.assertEqual(ca.trim('One. Two three. ' * 3, 20), 'One. Two three. One.')
        self.assertEqual(ca.trim('One. Two three. ' * 3, 18), 'One. Two three.')
        self.assertEqual(ca.trim('short'), 'short')

    def test_about_end_to_end(self):
        calls = []

        async def fake(ctx, url, params=None, headers=None):
            calls.append(url)
            if 'sparql' in url:
                self.assertIn('"0000320193"', params['query'])
                return {'results': {'bindings': [{'article': {'value': 'https://en.wikipedia.org/wiki/Apple_Inc.'}, 'item': {'value': 'x/Q312'}}]}}
            return {'extract': 'Apple Inc. is an American multinational technology company.', 'content_urls': {'desktop': {'page': 'https://en.wikipedia.org/wiki/Apple_Inc.'}}}
        ca.web_json = fake
        out = asyncio.run(ca.about(Ctx(), {'cik': 320193}))
        self.assertEqual(out['source'], 'Wikipedia')
        self.assertTrue(out['about'].startswith('Apple Inc.'))
        self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
