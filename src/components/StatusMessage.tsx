import { ReactNode } from "react";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";

export function LoadingState({ label }: { label: string }) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs">
        <Loader />
        <Text c="dimmed" size="sm">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <Alert color="red" title={title}>
      {message}
    </Alert>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Center py={48}>
      <Stack align="center" gap={4}>
        <Text fw={600} size="lg">
          {title}
        </Text>
        {children && (
          <Text c="dimmed" size="sm" ta="center">
            {children}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
