import React from 'react';
import {
  Checkbox,
  MultiSelect,
  NumberInput,
  Radio,
  Select,
  Stack,
  Textarea,
  TextInput
} from '@mantine/core';
import { QuestionField, QuestionOption } from '../../../shared/types';
import { QuestionValue, questionInputKind } from '../../../shared/agent/questionForm';

/**
 * One field of an agent's question, in whatever input its schema calls for.
 * Which input that is gets decided in `questionInputKind`; this file only
 * draws it. A few choices are laid out as radios or checkboxes so their
 * descriptions can be read; a long list folds into a dropdown.
 */

interface QuestionFieldInputProps {
  field: QuestionField;
  value: QuestionValue | undefined;
  onChange: (value: QuestionValue) => void;
}

const asList = (value: QuestionValue | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];

const selectData = (options: QuestionOption[]) =>
  options.map((option) => ({ value: option.value, label: option.label }));

export const QuestionFieldInput: React.FC<QuestionFieldInputProps> = ({ field, value, onChange }) => {
  const label = field.title || field.name;
  const options = field.options ?? [];
  const common = { label, description: field.description, withAsterisk: field.required };

  switch (questionInputKind(field)) {
    case 'checkbox':
      return (
        <Checkbox
          size="xs"
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
          label={label}
          description={field.description}
        />
      );

    case 'radio':
      return (
        <Radio.Group {...common} size="xs" value={typeof value === 'string' ? value : null} onChange={onChange}>
          <Stack gap={6} mt={6}>
            {options.map((option) => (
              <Radio key={option.value} size="xs" value={option.value} label={option.label} description={option.description} />
            ))}
          </Stack>
        </Radio.Group>
      );

    case 'checkboxes':
      return (
        <Checkbox.Group {...common} size="xs" value={asList(value)} onChange={onChange}>
          <Stack gap={6} mt={6}>
            {options.map((option) => (
              <Checkbox key={option.value} size="xs" value={option.value} label={option.label} description={option.description} />
            ))}
          </Stack>
        </Checkbox.Group>
      );

    case 'select':
      return (
        <Select
          {...common}
          size="xs"
          data={selectData(options)}
          value={typeof value === 'string' ? value : null}
          onChange={(v) => onChange(v ?? '')}
        />
      );

    case 'multiselect':
      return <MultiSelect {...common} size="xs" data={selectData(options)} value={asList(value)} onChange={onChange} />;

    case 'number':
      return (
        <NumberInput
          {...common}
          size="xs"
          allowDecimal={field.type === 'number'}
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v)}
        />
      );

    case 'text': {
      // Long free text gets a textarea; short answers stay on one line.
      const Component = field.description && field.description.length > 80 ? Textarea : TextInput;
      return (
        <Component
          {...common}
          size="xs"
          autosize
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    }
  }
};
