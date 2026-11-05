import { Fragment, useEffect, useRef } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  NumberInputHandlers,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Transition,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { OrderCard } from "../components/OrderCard";
import { db } from "../firebase";
import { useOpenOrders } from "../hooks/useOpenOrders";
import { MenuCategory, MenuItem, Order, OrderCategory } from "../types";
import { formatCents, isSpecialtyOnly, notifyError, toCents, toFormKey, ZONES } from "../utils";
import classes from "../App.module.css";

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
    <path d="M9 3v12M3 9h12" />
  </svg>
);

const MinusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
    <path d="M3 9h12" />
  </svg>
);

/** Quantities keyed by escaped category and item names. */
type Quantities = Record<string, Record<string, number | string>>;

const roundedQuantity = (value: number | string) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, Math.ceil(quantity)) : 0;
};

// `specialtyOnly` distinguishes new orders from legacy ones in useOpenOrders.
const saveOrder = (order: Order) =>
  addDoc(collection(db, "orders"), {
    ...order,
    timestamp: serverTimestamp(),
    specialtyOnly: isSpecialtyOnly(order.categories),
  });

const emptyQuantities = (menu: MenuCategory[]): Quantities =>
  Object.fromEntries(
    menu.map((category) => [
      toFormKey(category.categoryName),
      Object.fromEntries(category.items.map((item) => [toFormKey(item.itemName), 0])),
    ]),
  );

const quantityOf = (quantities: Quantities, category: MenuCategory, item: MenuItem) =>
  roundedQuantity(quantities[toFormKey(category.categoryName)]?.[toFormKey(item.itemName)] ?? 0);

const calculateTotalCents = (menu: MenuCategory[], quantities: Quantities) =>
  menu.reduce(
    (sum, category) =>
      category.items.reduce((sum, item) => sum + item.priceCents * quantityOf(quantities, category, item), sum),
    0,
  );

const toOrderCategories = (menu: MenuCategory[], quantities: Quantities): Order["categories"] =>
  Object.fromEntries(
    menu.flatMap((menuCategory): [string, OrderCategory][] => {
      const items = Object.fromEntries(
        menuCategory.items
          .map((item) => [item.itemName, quantityOf(quantities, menuCategory, item)] as const)
          .filter(([, quantity]) => quantity > 0)
          .map(([itemName, quantity]) => [itemName, { quantity }]),
      );
      return Object.keys(items).length > 0 ? [[menuCategory.categoryName, { done: false, items }]] : [];
    }),
  );

const itemsError = (menu: MenuCategory[], quantities: Quantities) => {
  if (missingItems(menu, quantities).length > 0) return "Remove unavailable items before submitting.";
  const soldOut = menu.flatMap((category) =>
    category.items.filter((item) => item.stock === "none" && quantityOf(quantities, category, item) > 0),
  );
  if (soldOut.length > 0) return `Sold out, remove from order: ${soldOut.map((item) => item.itemName).join(", ")}`;
  return Object.keys(toOrderCategories(menu, quantities)).length > 0 ? null : "Select at least one item";
};

const missingItems = (menu: MenuCategory[], quantities: Quantities) => {
  const available = emptyQuantities(menu);
  return Object.entries(quantities).flatMap(([categoryKey, items]) =>
    Object.entries(items)
      .filter(([itemKey, quantity]) => roundedQuantity(quantity) > 0 && available[categoryKey]?.[itemKey] === undefined)
      .map(([itemKey, quantity]) => ({ categoryKey, itemKey, quantity: roundedQuantity(quantity) })),
  );
};

const discountError = (menu: MenuCategory[], values: { items: Quantities; discount: number | string }) =>
  calculateTotalCents(menu, values.items) >= toCents(values.discount) ? null : "Discount greater than order total";

const SLOW_SAVE_MS = 4000;

const DEFAULT_VALUES = {
  number: null as number | null,
  notes: "",
  /** Dollars, converted to cents on submit. */
  discount: 0 as number | string,
  zone: "Undecided",
};

/** Firestore retries offline writes; the in-memory queue is lost if the tab closes. */
async function sendOrder(order: Order, restore: () => void) {
  const title = `Order #${order.number}`;
  const id = notifications.show({ loading: true, title: `Sending ${title}...`, message: "", autoClose: false, withCloseButton: false });
  const slowTimer = setTimeout(
    () =>
      notifications.update({
        id,
        color: "orange",
        title: `Still sending ${title}...`,
        message: "The connection is slow. Keep this tab open, and don't re-enter the order: it will go through once the connection recovers.",
      }),
    SLOW_SAVE_MS,
  );
  try {
    await saveOrder(order);
    notifications.update({ id, loading: false, color: "green", title: `${title} sent`, message: "", autoClose: 3000, withCloseButton: true });
  } catch (error) {
    console.error(`${title} was NOT saved`, error);
    notifications.update({
      id,
      loading: false,
      color: "red",
      title: `${title} was NOT saved`,
      message: (
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{error instanceof Error ? error.message : "An unexpected error occurred."}</Text>
          <Button size="xs" color="red" variant="outline" onClick={() => { restore(); notifications.hide(id); }}>
            Put it back in the form (replaces what's there)
          </Button>
        </Stack>
      ),
      autoClose: false,
      withCloseButton: true,
    });
  } finally {
    clearTimeout(slowTimer);
  }
}

export function CashierPage({ menu }: { menu: MenuCategory[] }) {
  const columns = useMediaQuery("(min-width: 48em)", true, { getInitialValueInEffect: false }) ? 2 : 1;
  const handlersRef = useRef<Record<string, NumberInputHandlers | null | undefined>>({});
  const latestMenu = useRef(menu);

  useEffect(() => { latestMenu.current = menu; }, [menu]);

  const form = useForm({
    mode: "controlled",
    initialValues: { ...DEFAULT_VALUES, items: emptyQuantities(menu) },
    validate: {
      number: (value: number | null) => (value && value > 0 ? null : "Order number is required"),
      discount: (_: number | string, values: { items: Quantities; discount: number | string }) => discountError(menu, values),
      items: (value: Quantities) => itemsError(menu, value),
    },
  });

  // Add new menu items to the form and update its reset defaults.
  useEffect(() => {
    const { items } = form.getValues();
    for (const category of menu) {
      const categoryKey = toFormKey(category.categoryName);
      for (const item of category.items) {
        const itemKey = toFormKey(item.itemName);
        if (items[categoryKey]?.[itemKey] === undefined) form.setFieldValue(`items.${categoryKey}.${itemKey}`, 0);
      }
    }
    form.setInitialValues({ ...DEFAULT_VALUES, items: emptyQuantities(menu) });
    // The form object changes on every render; only menu changes should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const totalCents = calculateTotalCents(menu, form.values.items) - toCents(form.values.discount);

  const { items, discount } = form.values;
  const unavailableItems = missingItems(menu, items);
  const visibleItemsError = form.errors.items ? itemsError(menu, items) : null;
  const visibleDiscountError = form.errors.discount ? discountError(menu, { items, discount }) : null;

  // Listen for open orders so pending local writes are included in duplicate checks.
  const { orders: openOrders, error: ordersError } = useOpenOrders();

  const handleSubmit = (values: typeof form.values) => {
    const order: Order = {
      number: values.number ?? 0,
      totalCents: calculateTotalCents(menu, values.items) - toCents(values.discount),
      discountCents: toCents(values.discount),
      notes: values.notes,
      completed: false,
      zone: values.zone,
      categories: toOrderCategories(menu, values.items),
    };

    const duplicate = openOrders?.find((openOrder) => openOrder.number === order.number);
    // The timestamp is null until the server acknowledges the write.
    const placedAt = duplicate?.timestamp?.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    modals.openConfirmModal({
      title: "Review Order",
      children: (
        <Stack>
          {(ordersError || openOrders === null) && (
            <Alert color="orange" title="Duplicate check unavailable">Open orders could not be checked. Verify the order number before submitting.</Alert>
          )}
          {duplicate && (
            <Alert color="orange" title={`Order #${order.number} is already open`}>
              It was placed {placedAt ? `at ${placedAt}` : "just now"} and hasn't been completed. Only submit if you're
              sure this number is free.
            </Alert>
          )}
          <Text size="sm">Please confirm that the order details are correct:</Text>
          <OrderCard order={order} menu={menu} />
        </Stack>
      ),
      labels: { confirm: duplicate ? "Submit anyway" : "Confirm", cancel: "Cancel" },
      confirmProps: duplicate && { color: "orange" },
      onConfirm: () => {
        const currentMenu = latestMenu.current;
        if (
          itemsError(currentMenu, values.items) ||
          discountError(currentMenu, values) ||
          calculateTotalCents(currentMenu, values.items) - toCents(values.discount) !== order.totalCents ||
          JSON.stringify(toOrderCategories(currentMenu, values.items)) !== JSON.stringify(order.categories)
        ) {
          notifyError("Menu changed", "Review the updated order and confirm it again.");
          return;
        }
        form.reset();
        void sendOrder(order, () => form.setValues(values));
      },
    });
  };

  const renderCategory = (category: MenuCategory, i: number) => {
    const categoryKey = toFormKey(category.categoryName);
    const isFirstRow = i < columns;
    return (
      <Fragment key={category.categoryName}>
        <Table.Tr style={{ display: "flex", padding: `${isFirstRow ? "0" : "12px"} 0 4px 0` }}>
          <Table.Td display="flex">
            <Title order={4}>{category.categoryName}</Title>
          </Table.Td>
        </Table.Tr>
        {category.items.map((item) => {
          const formPath = `items.${categoryKey}.${toFormKey(item.itemName)}`;
          const soldOut = item.stock === "none";
          const inOrder = quantityOf(form.getValues().items, category, item) !== 0;
          return (
            <Table.Tr key={item.itemName} className={classes.flexRow}>
              <Table.Td className={classes.flexGrow}>
                <Group gap={6}>
                  <Text span td={soldOut ? "line-through" : undefined} c={soldOut ? "dimmed" : undefined}>
                    {item.itemName}
                  </Text>
                  {item.flags && item.flags.length > 0 && (
                    <Text span size="xs" c="dimmed">
                      {item.flags.join(", ")}
                    </Text>
                  )}
                  {soldOut && (
                    <Badge color="red" size="sm">
                      Sold out
                    </Badge>
                  )}
                  {item.stock === "low" && (
                    <Badge color="yellow" size="sm">
                      Low
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td className={classes.cashPriceContainer}>{formatCents(item.priceCents)}</Table.Td>
              <Table.Td className={classes.numberButtonContainer}>
                <Button.Group>
                  <Transition
                    mounted={inOrder}
                    keepMounted
                    transition="slide-left"
                    duration={200}
                    timingFunction="ease"
                  >
                    {(styles) => (
                      <>
                        <Button
                          variant="default"
                          size="md"
                          className={classes.stepButton}
                          aria-label={`Remove one ${item.itemName}`}
                          onClick={() => handlersRef.current[formPath]?.decrement()}
                          style={styles}
                        >
                          <MinusIcon />
                        </Button>
                        <NumberInput
                          style={styles}
                          classNames={{ input: classes.numberButtonInput }}
                          hideControls
                          size="md"
                          handlersRef={(el) => (handlersRef.current[formPath] = el)}
                          min={0}
                          max={soldOut ? quantityOf(form.getValues().items, category, item) : 99}
                          key={form.key(formPath)}
                          {...form.getInputProps(formPath)}
                          onBlur={(event) => {
                            form.getInputProps(formPath).onBlur(event);
                            form.setFieldValue(formPath, roundedQuantity(form.getValues().items[categoryKey]?.[toFormKey(item.itemName)] ?? 0));
                          }}
                        />
                      </>
                    )}
                  </Transition>
                  <Button
                    variant="default"
                    size="md"
                    className={classes.stepButton}
                    style={
                      inOrder
                        ? undefined
                        : {
                            borderRadius: "var(--button-radius, var(--mantine-radius-default))",
                            borderInlineStartWidth: "var(--button-border-width)",
                          }
                    }
                    aria-label={`Add one ${item.itemName}`}
                    disabled={soldOut}
                    onClick={() => handlersRef.current[formPath]?.increment()}
                  >
                    <PlusIcon />
                  </Button>
                </Button.Group>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Fragment>
    );
  };

  return (
    // Sticky positioning requires visible overflow.
    <Card shadow="sm" radius="md" p="md" style={{ overflow: "visible" }}>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Card.Section withBorder>
          <Title order={2}>Create Order</Title>
        </Card.Section>
        {unavailableItems.length > 0 && (
          <Alert color="orange" title="Menu items are no longer available">
            <Text size="sm">These items were removed or renamed. Remove them and select replacements before submitting.</Text>
            {unavailableItems.map(({ categoryKey, itemKey, quantity }) => (
              <Group key={`${categoryKey}.${itemKey}`} justify="space-between">
                <Text size="sm">{quantity} × {decodeURIComponent(itemKey)} ({decodeURIComponent(categoryKey)})</Text>
                <Button size="xs" variant="outline" onClick={() => form.setFieldValue(`items.${categoryKey}.${itemKey}`, 0)}>Remove</Button>
              </Group>
            ))}
          </Alert>
        )}
        <Card.Section withBorder>
          <SimpleGrid cols={columns}>
            {Array.from({ length: columns }, (_, column) => (
              <Table key={column}>
                <Table.Tbody>
                  {menu.map((category, i) => i % columns === column && renderCategory(category, i))}
                </Table.Tbody>
              </Table>
            ))}
          </SimpleGrid>
        </Card.Section>
        <Card.Section withBorder>
          <Group className={classes.cashOptions}>
            <NumberInput
              withAsterisk
              label="Order Number"
              hideControls
              min={1}
              key={form.key("number")}
              {...form.getInputProps("number")}
            />
            <NumberInput
              label="Apply Discount"
              min={0}
              key={form.key("discount")}
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator=","
              prefix="$"
              {...form.getInputProps("discount")}
              error={visibleDiscountError}
            />
            <Select
              label="Seating Zone"
              allowDeselect={false}
              data={ZONES}
              key={form.key("zone")}
              {...form.getInputProps("zone")}
            />
            <TextInput
              label="Notes"
              key={form.key("notes")}
              className={classes.flexGrow}
              {...form.getInputProps("notes")}
            />
          </Group>
        </Card.Section>
        <Card.Section className={classes.cashSubmit}>
          <Text c="red" size="sm">
            {visibleItemsError}
          </Text>
          <Group gap="md" ml="auto">
            <Text size="lg">
              Total:{" "}
              <Text span fw={700} size="xl">
                {formatCents(totalCents)}
              </Text>
            </Text>
            <Button type="submit" size="md">
              Submit Order
            </Button>
          </Group>
        </Card.Section>
      </form>
    </Card>
  );
}
