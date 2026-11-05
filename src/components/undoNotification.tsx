import { Button, Group } from "@mantine/core";
import { hideNotification, notifications } from "@mantine/notifications";
import { notifyError } from "../utils";

export function showUndoNotification(id: string, message: string, undo: () => Promise<unknown>) {
  notifications.show({
    id,
    message: (
      <Group justify="space-between">
        {message}
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await undo();
              hideNotification(id);
            } catch (error) {
              notifyError("Failed to undo", error);
            }
          }}
        >
          Undo
        </Button>
      </Group>
    ),
    autoClose: 8000,
  });
}
