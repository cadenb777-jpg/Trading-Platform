/** Saves your scripts in this browser and turns each one into an indicator in the Indicators menu. */
import { registerCustomIndicator, unregisterCustomIndicator } from '../indicators/library';
import type { IndicatorDef } from '../indicators/types';
import { loadJson, saveJson } from '../storage';
import { compileScript, type CompiledScript } from './interpreter';

export interface UserScript {
  id: string;
  source: string;
  updated: number;
}

const KEY = 'tp:scripts:v1';
let scripts: UserScript[] = loadJson<UserScript[]>(KEY) ?? [];

export const scriptDefId = (id: string) => `script:${id}`;
export const listScripts = () => [...scripts].sort((a, b) => b.updated - a.updated);
export const getScript = (id: string) => scripts.find((s) => s.id === id);

export function saveScript(script: UserScript) {
  scripts = [...scripts.filter((s) => s.id !== script.id), script];
  saveJson(KEY, scripts);
}

export function deleteScript(id: string) {
  scripts = scripts.filter((s) => s.id !== id);
  saveJson(KEY, scripts);
  unregisterCustomIndicator(scriptDefId(id));
}

export function toIndicatorDef(id: string, compiled: CompiledScript): IndicatorDef {
  return {
    id: scriptDefId(id),
    name: compiled.name,
    shortName: compiled.shortName,
    category: 'My scripts',
    description: 'Your own script. Edit it in Chart → Scripts.',
    placement: compiled.overlay ? 'overlay' : 'separate',
    inputs: compiled.inputs,
    plots: compiled.plots,
    levels: compiled.levels,
    compute: (bars, params) => {
      try {
        return compiled.run(bars, params);
      } catch (err) {
        console.warn(`Script "${compiled.name}" failed`, err);
        return {};
      }
    },
  };
}

/** Compiles a saved script and adds it to the Indicators menu. Returns the error if it doesn't compile. */
export function registerScript(script: UserScript): Error | null {
  try {
    registerCustomIndicator(toIndicatorDef(script.id, compileScript(script.source)));
    return null;
  } catch (err) {
    unregisterCustomIndicator(scriptDefId(script.id));
    return err as Error;
  }
}

export function registerAllScripts() {
  for (const script of scripts) registerScript(script);
}

/** A short name for the script list, taken from its indicator("...") title. */
export function scriptTitle(source: string): string {
  return /(?:indicator|study)\(\s*["']([^"']+)["']/.exec(source)?.[1] ?? 'Untitled script';
}
