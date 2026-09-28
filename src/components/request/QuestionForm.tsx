import React, { useState } from 'react';
import { Button, Group, Stack } from '@mantine/core';
import { ExternalLink } from 'lucide-react';
import { PendingQuestion, PermissionAnswer } from '../../../shared/types';
import { httpUrl } from '../../../shared/task/links';
import {
  QuestionValue,
  initialQuestionValues,
  missingQuestionFields,
  questionAnswerContent
} from '../../../shared/agent/questionForm';
import { QuestionFieldInput } from './QuestionFieldInput';

/**
 * The form an agent's question generates, and the two ways out of it: answer,
 * or decline. What each field starts as and what counts as answered is in
 * `shared/agent/questionForm`; what is here is the form itself.
 */

interface QuestionFormProps {
  question: PendingQuestion;
  busy?: boolean;
  onAnswer: (answer: PermissionAnswer) => void;
}

export const QuestionForm: React.FC<QuestionFormProps> = ({ question, busy, onAnswer }) => {
  const [values, setValues] = useState<Record<string, QuestionValue>>(() =>
    initialQuestionValues(question.fields)
  );

  const set = (name: string, value: QuestionValue) => setValues((prev) => ({ ...prev, [name]: value }));
  const missing = missingQuestionFields(question.fields, values);
  // The server already drops anything but http(s); a state file from before
  // it did is not trusted either.
  const link = httpUrl(question.url);

  return (
    <Stack gap={10}>
      {question.mode === 'url' && link && (
        <Button
          component="a"
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          size="xs"
          variant="light"
          color="accent"
          leftSection={<ExternalLink className="w-3.5 h-3.5" />}
        >
          Open link to continue
        </Button>
      )}

      {question.fields.map((field) => (
        <QuestionFieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(value) => set(field.name, value)}
        />
      ))}

      <Group gap="xs" justify="flex-end">
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          disabled={busy}
          onClick={() => onAnswer({ kind: 'question', requestId: question.requestId, action: 'decline' })}
        >
          Decline
        </Button>
        <Button
          size="xs"
          color="accent"
          loading={busy}
          disabled={missing.length > 0}
          onClick={() =>
            onAnswer({
              kind: 'question',
              requestId: question.requestId,
              action: 'accept',
              content: questionAnswerContent(question.fields, values)
            })
          }
        >
          {question.fields.length === 0 ? 'Continue' : 'Send answer'}
        </Button>
      </Group>
    </Stack>
  );
};
