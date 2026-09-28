import React from 'react';
import { Paper, Text } from '@mantine/core';

/** Nothing in this list, said quietly. */

export const Empty: React.FC<{ children: string }> = ({ children }) => (
  <Paper p="md" radius="md" className="bg-surface border border-line/60 text-center">
    <Text size="xs" c="dimmed">
      {children}
    </Text>
  </Paper>
);
