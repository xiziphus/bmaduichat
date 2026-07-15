import { describe, it, expect } from 'vitest';
import { buildMarySystemPrompt } from '@/lib/mary';
import { getTechniques, getTechnique } from '@/lib/techniques-catalog';

describe('buildMarySystemPrompt', () => {
  const prompt = buildMarySystemPrompt();

  it('embeds BMad persona source verbatim (analyst customize.toml)', () => {
    expect(prompt).toContain('📊');
    expect(prompt).toContain(
      'Help the user ideate research and analyze before committing to a project',
    );
    expect(prompt).toContain(
      "Channels Michael Porter's strategic rigor and Barbara Minto's Pyramid Principle discipline.",
    );
    expect(prompt).toContain(
      "Treasure hunter's excitement for patterns, McKinsey memo's structure for findings.",
    );
    expect(prompt).toContain('Every finding grounded in verifiable evidence.');
    expect(prompt).toContain('Requirements stated with absolute precision.');
    expect(prompt).toContain('Every stakeholder voice represented.');
  });

  it('embeds the brainstorming SKILL.md framing verbatim', () => {
    expect(prompt).toContain('Aim past 100 ideas; resist concluding.');
    expect(prompt).toContain('the enemy of divergence');
    expect(prompt).toContain('Keep shifting the creative domain');
    expect(prompt).toContain('no multiple-choice menus');
  });

  it('embeds the Creative Partner stance (mode-partner.md) verbatim', () => {
    expect(prompt).toContain('Their fire, your kindling.');
    expect(prompt).toContain('"Yes, and" is the default move.');
    expect(prompt).toContain('Offer real alternatives');
    expect(prompt).toContain('Watch the ratio.');
    expect(prompt).toContain('reject any idea you offer');
  });

  it('embeds kickoff and phases (Run a Session, converge.md, finalize.md)', () => {
    expect(prompt).toContain('one compound question');
    expect(prompt).toContain('offer three paths');
    expect(prompt).toContain('Affinity Clustering');
    expect(prompt).toContain('Impact–Effort');
    expect(prompt).toContain('NUF Test');
    expect(prompt).toContain('Forced Ranking');
    expect(prompt).toContain('PMI (Plus / Minus / Interesting)');
    expect(prompt).toContain('MoSCoW');
    expect(prompt).toContain('Hand them the mirror first.');
    expect(prompt).toContain('Then add the connections they would miss.');
  });

  it('keeps honest-limits and chips protocol', () => {
    expect(prompt).toContain('noted for the builder');
    expect(prompt).toContain('<chips>[');
  });

  it('strips BMad mechanics that do not exist in this app', () => {
    expect(prompt).not.toContain('memlog.py');
    expect(prompt).not.toContain('uv run');
    expect(prompt).not.toContain('{project-root}');
  });

  it('lists the FULL catalog: a CSV-only technique and its verbatim gist (sentinel)', () => {
    // Lotus Blossom is absent from the old curated 8 — proves the catalog is the CSV.
    expect(prompt).toContain('Lotus Blossom');
    // Sentinel gist string, verbatim from brain-methods.csv.
    expect(prompt).toContain('Put the theme at the center of a 3x3 grid');
  });

  it('injects the current technique framing (gist, no launchPrompt) when given', () => {
    const t = getTechnique('lotus-blossom') ?? getTechniques()[0];
    const withTechnique = buildMarySystemPrompt(t.id);
    expect(withTechnique).toContain(`CURRENT TECHNIQUE — the user just launched "${t.name}"`);
    expect(withTechnique).toContain(t.gist);
    expect(prompt).not.toContain('CURRENT TECHNIQUE');
  });
});
