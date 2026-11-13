"""Only articles the helper can summarise are shown."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import schwab_helper as sh  # noqa: E402


class FakeNews(sh.NewsFetcher):
    def __init__(self, readable, slow=()):
        super().__init__()
        self.ok, self.slow, self.asked = set(readable), set(slow), []

    async def get(self, symbols, query=''):
        return [{'link': f'https://x/{n}', 'title': n, 'otherLinks': []} for n in ('a', 'b', 'c', 'd')], []

    async def summary(self, links, title):
        self.asked.append(title)
        if title in self.slow:
            await asyncio.sleep(0.3)
        if title not in self.ok:
            raise sh.HelperError('The article text could not be read')
        return {'points': ['x'], 'description': ''}


class Readable(unittest.TestCase):
    def test_only_summarisable_articles(self):
        news = FakeNews({'a', 'c'})
        items, _ = asyncio.run(news.get_readable([], budget=2))
        self.assertEqual([i['title'] for i in items], ['a', 'c'])

    def test_failures_not_retried_soon(self):
        async def run():
            news = FakeNews({'a'})
            await news.get_readable([], budget=2)
            news.asked.clear()
            await news.get_readable([], budget=2)
            return news.asked
        asked = asyncio.run(run())
        self.assertNotIn('b', asked)  # remembered as unreadable

    def test_slow_ones_wait_for_next_refresh(self):
        async def run():
            news = FakeNews({'a', 'b'}, slow={'b'})
            first, _ = await news.get_readable([], budget=0.1)
            await asyncio.sleep(0.4)
            second, _ = await news.get_readable([], budget=0.1)
            return [i['title'] for i in first], [i['title'] for i in second]
        first, second = asyncio.run(run())
        self.assertEqual(first, ['a'])
        self.assertEqual(second, ['a', 'b'])


if __name__ == '__main__':
    unittest.main()
