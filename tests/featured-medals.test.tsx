import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { FeaturedBadge } from '../src/components/FeaturedBadge';
import { featuredMedals, normalizeMedalTier } from '../shared/featured-medals';

test('exported medals preserve the selected tier and have no nonfunctional controls', () => {
  for (const medal of featuredMedals) {
    const dom = new JSDOM(renderToStaticMarkup(<FeaturedBadge tier={medal.id} />));
    try {
      const doc = dom.window.document;
      assert(doc.querySelector(`.medal-${medal.id}`));
      assert.equal(Boolean(doc.querySelector('.featured-shine')), medal.level >= 1);
      assert.equal(Boolean(doc.querySelector('.featured-sparkles')), medal.level >= 2);
      assert.equal(Boolean(doc.querySelector('.medal-halo-glow')), medal.level >= 3);
      assert.equal(doc.querySelector('.medal-orbits'), null);
      assert.equal(Boolean(doc.querySelector('.medal-aurora-fill')), medal.level === 4);
      assert.equal(Boolean(doc.querySelector('.medal-jewel-fill')), medal.level >= 5);
      assert.equal(doc.querySelector('.medal-corona-rays'), null);
      assert.equal(doc.querySelector('button'), null);
    } finally {
      dom.window.close();
    }
  }
  assert(!renderToStaticMarkup(<FeaturedBadge />).includes('featured-shine'));
});

test('retired saved medals resolve to the available aurora tier', () => {
  assert.equal(featuredMedals.length, 7);
  assert.equal(featuredMedals.at(-2)?.views, 50000);
  assert.equal(featuredMedals.at(-1)?.views, 100000);
  for (const saved of ['orbit', 'corona', 'aurora']) {
    assert.equal(normalizeMedalTier(saved), 'aurora');
    const html = renderToStaticMarkup(<FeaturedBadge tier={saved as never} />);
    assert(html.includes('medal-aurora-fill'));
    assert(!html.includes('medal-orbits'));
    assert(!html.includes('medal-corona-rays'));
  }
  assert.equal(normalizeMedalTier(undefined), 'gold');
  assert.equal(normalizeMedalTier('unknown'), 'gold');
});
