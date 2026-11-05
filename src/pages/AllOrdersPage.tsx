import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  Badge,
  Button,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { EmptyState, ErrorState, LoadingState } from "../components/StatusMessage";
import { db } from "../firebase";
import { orderFromDoc } from "../fromFirestore";
import { MenuCategory, Order, OrderItems } from "../types";
import { byKeyOrder, formatCents, menuItemNames, notifySnapshotError, ZONES, zoneToColor } from "../utils";

interface SoldItem {
  categoryName: string;
  itemName: string;
  quantity: number;
}

type StatusFilter = "all" | "open" | "completed";
type SortOrder = "oldest" | "newest";

interface OrderFilters {
  search: string;
  status: StatusFilter;
  zones: string[];
  categories: string[];
  /** YYYY-MM-DD so plain string comparison is chronological. */
  from: string;
  to: string;
  sort: SortOrder;
}

const NO_FILTERS: OrderFilters = {
  search: "",
  status: "all",
  zones: [],
  categories: [],
  from: "",
  to: "",
  sort: "oldest",
};

const isFiltered = ({ search, status, zones, categories, from, to }: OrderFilters) =>
  search.trim() !== "" || status !== "all" || zones.length > 0 || categories.length > 0 || from !== "" || to !== "";

const toDateKey = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");

/** The server timestamp is null until the write is acknowledged, so a pending order counts as placed now. */
const placedAt = (order: Order, now: number) => order.timestamp?.toDate() ?? new Date(now);

const logCategories = (orders: Order[], menu: MenuCategory[]) => {
  const menuNames = menu.map((category) => category.categoryName);
  const pastNames = [...new Set(orders.flatMap((order) => Object.keys(order.categories)))]
    .filter((name) => !menuNames.includes(name))
    .sort();
  return [...menuNames, ...pastNames];
};

/** Order numbers match exactly so "12" doesn't also find #112. */
const matchesSearch = (order: Order, search: string) => {
  const term = search.trim().toLowerCase();
  if (term === "") return true;
  const itemNames = Object.values(order.categories).flatMap((category) => Object.keys(category.items));
  return (
    String(order.number) === term ||
    [order.notes, ...itemNames].some((text) => text.toLowerCase().includes(term))
  );
};

const withinDates = (order: Order, from: string, to: string, now: number) => {
  const day = toDateKey(placedAt(order, now));
  return (from === "" || day >= from) && (to === "" || day <= to);
};

const filterOrders = (
  orders: Order[],
  { search, status, zones, categories, from, to, sort }: OrderFilters,
  now: number,
) => {
  const matching = orders.filter(
    (order) =>
      withinDates(order, from, to, now) &&
      (status === "all" || order.completed === (status === "completed")) &&
      (zones.length === 0 || zones.includes(order.zone ?? "")) &&
      (categories.length === 0 || categories.some((name) => name in order.categories)) &&
      matchesSearch(order, search),
  );
  return sort === "newest" ? [...matching].reverse() : matching;
};

const soldItemKey = ({ categoryName, itemName }: SoldItem) => JSON.stringify([categoryName, itemName]);

const itemsToString = (items: OrderItems | undefined, menuOrder: string[]) =>
  items === undefined
    ? "-"
    : Object.entries(items)
        .sort(byKeyOrder(menuOrder))
        .map(([itemName, { quantity }]) => `${quantity} ${itemName}`)
        .join(", ");

/** Revenue ignores the category filter because discounts apply to whole orders. */
function computeAnalytics(orders: Order[], menu: MenuCategory[], categories: string[]) {
  const shown = (categoryName: string) => categories.length === 0 || categories.includes(categoryName);
  const lineItems = orders.flatMap((order) =>
    Object.entries(order.categories)
      .filter(([categoryName]) => shown(categoryName))
      .flatMap(([categoryName, category]) =>
        Object.entries(category.items).map(
          ([itemName, { quantity }]): SoldItem => ({ categoryName, itemName, quantity }),
        ),
      ),
  );
  // Unsold menu items come first so they are listed with a quantity of 0.
  const unsold = menu
    .filter((category) => shown(category.categoryName))
    .flatMap((category) =>
      category.items.map(
        (item): SoldItem => ({ categoryName: category.categoryName, itemName: item.itemName, quantity: 0 }),
      ),
    );
  const soldByItem = [...unsold, ...lineItems].reduce((sold, line) => {
    const key = soldItemKey(line);
    return sold.set(key, { ...line, quantity: (sold.get(key)?.quantity ?? 0) + line.quantity });
  }, new Map<string, SoldItem>());
  const totalItems = lineItems.reduce((sum, { quantity }) => sum + quantity, 0);
  const totalRevenueCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
  return {
    totals: [
      ["Orders", orders.length.toLocaleString("en-US")],
      ["Items Sold", totalItems.toLocaleString("en-US")],
      ["Revenue", formatCents(totalRevenueCents)],
    ],
    soldByItem: [...soldByItem.values()],
    categories: logCategories(orders, menu).filter(shown),
  };
}

export function AllOrdersPage({ menu }: { menu: MenuCategory[] }) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const setFilter = <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "orders"), orderBy("timestamp")),
        (snapshot) => setOrders(snapshot.docs.map(orderFromDoc)),
        (error) => {
          setLoadError(error.message);
          notifySnapshotError("orders")(error);
        },
      ),
    [],
  );

  const categoryOptions = useMemo(() => logCategories(orders ?? [], menu), [orders, menu]);
  const filteredOrders = useMemo(() => filterOrders(orders ?? [], filters, Date.now()), [orders, filters]);
  const spansDays = useMemo(
    () => new Set(filteredOrders.map((order) => toDateKey(placedAt(order, Date.now())))).size > 1,
    [filteredOrders],
  );
  const analytics = useMemo(
    () => computeAnalytics(filteredOrders, menu, filters.categories),
    [filteredOrders, menu, filters.categories],
  );

  if (loadError) return <ErrorState title="Failed to load orders" message={loadError} />;
  if (orders === null) return <LoadingState label="Loading orders..." />;

  return (
    <Stack>
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group align="flex-end" gap="sm">
            <TextInput
              label="Search"
              placeholder="Order #, notes, or item"
              value={filters.search}
              onChange={(e) => setFilter("search", e.currentTarget.value)}
              style={{ flex: "1 1 220px" }}
            />
            <TextInput
              type="date"
              label="From"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => setFilter("from", e.currentTarget.value)}
              style={{ flex: "0 1 170px" }}
            />
            <TextInput
              type="date"
              label="To"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => setFilter("to", e.currentTarget.value)}
              style={{ flex: "0 1 170px" }}
            />
            <Button
              variant="default"
              onClick={() => {
                const today = toDateKey(new Date());
                setFilters((prev) => ({ ...prev, from: today, to: today }));
              }}
            >
              Today
            </Button>
            <MultiSelect
              label="Seating zone"
              placeholder={filters.zones.length === 0 ? "All zones" : undefined}
              data={ZONES}
              value={filters.zones}
              onChange={(zones) => setFilter("zones", zones)}
              clearable
              style={{ flex: "1 1 200px" }}
            />
            <MultiSelect
              label="Category"
              placeholder={filters.categories.length === 0 ? "All categories" : undefined}
              data={categoryOptions}
              value={filters.categories}
              onChange={(categories) => setFilter("categories", categories)}
              clearable
              style={{ flex: "1 1 200px" }}
            />
          </Group>
          <Group justify="space-between" gap="sm">
            <Group gap="sm">
              <SegmentedControl
                aria-label="Order status"
                value={filters.status}
                onChange={(status) => setFilter("status", status as StatusFilter)}
                data={[
                  { value: "all", label: "All" },
                  { value: "open", label: "Open" },
                  { value: "completed", label: "Completed" },
                ]}
              />
              <SegmentedControl
                aria-label="Sort order"
                value={filters.sort}
                onChange={(sort) => setFilter("sort", sort as SortOrder)}
                data={[
                  { value: "oldest", label: "Oldest first" },
                  { value: "newest", label: "Newest first" },
                ]}
              />
            </Group>
            {isFiltered(filters) && (
              <Group gap="sm">
                <Text size="sm" c="dimmed">
                  Showing {filteredOrders.length} of {orders.length} orders
                </Text>
                <Button variant="subtle" onClick={() => setFilters({ ...NO_FILTERS, sort: filters.sort })}>
                  Clear filters
                </Button>
              </Group>
            )}
          </Group>
        </Stack>
      </Paper>
      <Title order={2}>Analytics</Title>
      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        {analytics.totals.map(([label, value]) => (
          <Paper key={label} withBorder radius="md" p="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              {label}
            </Text>
            <Text fw={700} size="xl">
              {value}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Table.ScrollContainer minWidth={320}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Category</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th ta="right">Quantity Sold</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {analytics.soldByItem.map((soldItem) => (
              <Table.Tr key={soldItemKey(soldItem)}>
                <Table.Td c="dimmed">{soldItem.categoryName}</Table.Td>
                <Table.Td>{soldItem.itemName}</Table.Td>
                <Table.Td ta="right" c={soldItem.quantity === 0 ? "dimmed" : undefined}>
                  {soldItem.quantity}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Title order={2}>All Orders</Title>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" />
      ) : filteredOrders.length === 0 ? (
        <EmptyState title="No matching orders">Try removing a filter.</EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={550 + 150 * analytics.categories.length}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Time</Table.Th>
                <Table.Th ta="right">Price</Table.Th>
                <Table.Th ta="right">Discount</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Zone</Table.Th>
                <Table.Th>Notes</Table.Th>
                {analytics.categories.map((categoryName) => (
                  <Table.Th key={categoryName}>{categoryName}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredOrders.map((order) => (
                <Table.Tr key={order.id}>
                  <Table.Td fw={600}>{order.number}</Table.Td>
                  <Table.Td>
                    {order.timestamp
                      ?.toDate()
                      .toLocaleString("en-US", {
                        ...(spansDays && { month: "short", day: "numeric" }),
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                  </Table.Td>
                  <Table.Td ta="right">{formatCents(order.totalCents)}</Table.Td>
                  <Table.Td ta="right" c={order.discountCents === 0 ? "dimmed" : undefined}>
                    {formatCents(order.discountCents)}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={order.completed ? "green" : "yellow"}>
                      {order.completed ? "Completed" : "Open"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {order.zone ? (
                      <Badge variant="light" color={zoneToColor(order.zone)}>
                        {order.zone}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </Table.Td>
                  <Table.Td>{order.notes}</Table.Td>
                  {analytics.categories.map((categoryName) => (
                    <Table.Td key={categoryName}>
                      {itemsToString(order.categories[categoryName]?.items, menuItemNames(menu, categoryName))}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
