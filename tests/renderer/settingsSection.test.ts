// C2 section 5.11: SETTINGS_SECTIONS and SettingsSection (src/renderer/src/model/settingsSection.ts).
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../src/renderer/src/model/settingsSection';

describe('SETTINGS_SECTIONS', () => {
  it('is appearance, downloads, browser, tools, in that order (the order of C5\'s headings)', () => {
    expect([...SETTINGS_SECTIONS]).toEqual(['appearance', 'downloads', 'browser', 'tools']);
  });

  it('the type is the same four ids: the compiler checks this one statement, whose value is then read', () => {
    const all: SettingsSection[] = ['appearance', 'downloads', 'browser', 'tools'];
    expect(all).toEqual([...SETTINGS_SECTIONS]);
  });

  it('derived: has no duplicate and nothing else', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
    expect(SETTINGS_SECTIONS).toHaveLength(4);
  });

  it('derived: the order is the same on a second read (an array, not a one-shot iterator)', () => {
    expect([...SETTINGS_SECTIONS]).toEqual([...SETTINGS_SECTIONS]);
    expect(Array.isArray(SETTINGS_SECTIONS)).toBe(true);
  });
});
