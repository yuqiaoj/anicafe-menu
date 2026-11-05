import { Fragment } from "react";
import { Badge, Button, Card, Checkbox, Group, Table, Text, Title } from "@mantine/core";
import { useNow } from "../hooks/useNow";
import { MenuCategory, Order } from "../types";
import { byKeyOrder, isOrderReady, menuItemNames, zoneToColor } from "../utils";
import classes from "./OrderCard.module.css";

const LATE_MINUTES = 15;

function formatAge(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

function OrderAge({ placedAtMs }: { placedAtMs: number }) {
  const now = useNow();
  const minutes = Math.max(0, Math.floor((now - placedAtMs) / 60_000));
  const late = minutes >= LATE_MINUTES;
  return (
    <Text size="sm" c={late ? "orange" : "dimmed"} fw={late ? 600 : undefined}>
      {formatAge(minutes)}
    </Text>
  );
}

interface OrderCardProps {
  order: Order;
  /** Omit to show all. */
  categories?: string[];
  /** Sets the order of categories and items; ones no longer on the menu go last. */
  menu: MenuCategory[];
  completeOrder?: () => Promise<void>;
  /** "view" is read-only; omit to hide checkboxes. */
  completeCategory?: "view" | ((orderId: string, categoryName: string, value: boolean) => Promise<void>);
  flash?: "new" | "ready";
  onInteract?: () => void;
}

export function OrderCard({
  order,
  categories: shownCategories,
  menu,
  completeOrder,
  completeCategory,
  flash,
  onInteract,
}: OrderCardProps) {
  const categories = Object.entries(order.categories)
    .filter(([categoryName]) => !shownCategories || shownCategories.includes(categoryName))
    .sort(byKeyOrder(menu.map((category) => category.categoryName)));
  const ready = completeCategory !== undefined && isOrderReady(order, shownCategories);
  // The server timestamp is null until the write is acknowledged.
  const placedAtMs = order.timestamp?.toMillis();

  return (
    <Card
      shadow="sm"
      radius="md"
      p="md"
      withBorder
      className={flash ? classes.flash : undefined}
      data-flash={flash}
      // Capture child interactions without treating touch scrolling as a click.
      onClickCapture={onInteract}
      onFocusCapture={onInteract}
      style={{
        height: "420px",
        display: "flex",
        flexDirection: "column",
        borderColor: ready ? "var(--mantine-color-green-filled)" : undefined,
        borderWidth: ready ? 2 : undefined,
      }}
    >
      <Card.Section withBorder>
        <Group justify="space-between" wrap="nowrap" mih={36}>
          <Group gap="xs">
            <Title order={3}>Order #{order.number}</Title>
            {order.zone && <Badge color={zoneToColor(order.zone)}>{order.zone}</Badge>}
            {flash === "new" && <Badge color="blue">New</Badge>}
            {ready && (
              <Badge color="green" variant="light">
                Ready
              </Badge>
            )}
          </Group>
          {completeOrder && <Button onClick={completeOrder}>Complete</Button>}
        </Group>
        {placedAtMs !== undefined && <OrderAge placedAtMs={placedAtMs} />}
        {order.notes && (
          <Text lineClamp={3} mt={4} style={{ overflowWrap: "break-word" }}>
            <Text span fw={600}>
              Notes:
            </Text>{" "}
            {order.notes}
          </Text>
        )}
      </Card.Section>
      <Card.Section style={{ overflow: "auto" }}>
        <Table>
          <Table.Tbody>
            {categories.map(([categoryName, category]) => (
              <Fragment key={categoryName}>
                <Table.Tr>
                  <Table.Th>
                    <Title order={5}>{categoryName}</Title>
                  </Table.Th>
                  {completeCategory && order.id && (
                    <Table.Th style={{ display: "flex", justifyContent: "center", width: "40px" }}>
                      <Checkbox
                        checked={category.done}
                        readOnly={completeCategory === "view"}
                        onChange={(e) =>
                          completeCategory !== "view" &&
                          completeCategory(order.id!, categoryName, e.currentTarget.checked)
                        }
                      />
                    </Table.Th>
                  )}
                </Table.Tr>
                {Object.entries(category.items)
                  .sort(byKeyOrder(menuItemNames(menu, categoryName)))
                  .map(([itemName, item]) => (
                    <Table.Tr key={itemName}>
                      <Table.Td>{itemName}</Table.Td>
                      <Table.Td style={{ textAlign: "center", width: "40px" }}>{item.quantity}</Table.Td>
                    </Table.Tr>
                  ))}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Card.Section>
    </Card>
  );
}
