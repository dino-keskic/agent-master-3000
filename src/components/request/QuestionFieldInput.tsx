import React from 'react';
import { Checkbox, NumberInput, Select, Textarea, TextInput } from '@mantine/core';
import { QuestionField } from '../../../shared/types';
import { QuestionValue } from '../../../shared/agent/questionForm';

/** One field of an agent's question, in whatever input its schema calls for. */

interface QuestionFieldInputProps {
  field: QuestionField;
  value: QuestionValue | undefined;
  onChange: (value: QuestionValue) => void;
}

export const QuestionFieldInput: React.FC<QuestionFieldInputProps> = ({ field, value, onChange }) => {
  const label = field.title || field.name;

  if (field.type === 'boolean') {
    return (
      <Checkbox
        size="xs"
        checked={value === true}
        onChange={(e) => onChange(e.currentTarget.checked)}
        label={label}
        description={field.description}
      />
    );
  }

  if (field.options && field.options.length > 0) {
    return (
      <Select
        size="xs"
        label={label}
        description={field.description}
        withAsterisk={field.required}
        data={field.options}
        value={typeof value === 'string' ? value : null}
        onChange={(v) => onChange(v ?? '')}
      />
    );
  }

  if (field.type === 'number' || field.type === 'integer') {
    return (
      <NumberInput
        size="xs"
        label={label}
        description={field.description}
        withAsterisk={field.required}
        allowDecimal={field.type === 'number'}
        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
        onChange={(v) => onChange(v)}
      />
    );
  }

  // Long free text gets a textarea; short answers stay on one line.
  const Component = field.description && field.description.length > 80 ? Textarea : TextInput;
  return (
    <Component
      size="xs"
      label={label}
      description={field.description}
      withAsterisk={field.required}
      autosize
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
};
