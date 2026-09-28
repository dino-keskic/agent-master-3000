/**
 * Filling in an agent's question.
 *
 * ACP's `elicitation/create` hands over a small schema and waits. The form is
 * generated from it, so the rules about what a field starts as, what counts as
 * unanswered, and what is worth sending back live here rather than inside the
 * inputs that show them.
 */

import { QuestionField } from '../types.js';

export type QuestionValue = string | number | boolean | string[];

/**
 * What a field shows before it is touched. Numbers start as text: a
 * half-typed "1." is not a number, and clearing the box has to stay possible.
 */
export function initialQuestionValue(field: QuestionField): QuestionValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean':
      return false;
    case 'array':
      return [];
    default:
      return '';
  }
}

export function initialQuestionValues(fields: QuestionField[]): Record<string, QuestionValue> {
  return Object.fromEntries(fields.map((field) => [field.name, initialQuestionValue(field)]));
}

/** Required fields still unanswered — blank text and empty lists both count. */
export function missingQuestionFields(
  fields: QuestionField[],
  values: Record<string, QuestionValue>
): QuestionField[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.name];
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return value === undefined || value === null;
  });
}

/**
 * What goes back to the agent. Numbers were held as text while typing, and an
 * optional field left blank is omitted rather than sent as an empty string —
 * the agent's schema treats those differently.
 */
export function questionAnswerContent(
  fields: QuestionField[],
  values: Record<string, QuestionValue>
): Record<string, QuestionValue> {
  const content: Record<string, QuestionValue> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (raw === undefined) continue;
    if (raw === '' && !field.required) continue;
    content[field.name] =
      field.type === 'number' || field.type === 'integer' ? Number(raw) : raw;
  }
  return content;
}
