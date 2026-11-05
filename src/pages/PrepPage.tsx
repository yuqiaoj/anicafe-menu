import { doc, FieldPath, updateDoc } from "firebase/firestore";
import { Chip, Group, Stack, Text } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { OrderCard } from "../components/OrderCard";
import { OrderGrid } from "../components/OrderGrid";
import { EmptyState, ErrorState, LoadingState } from "../components/StatusMessage";
import { db } from "../firebase";
import { useFlashIds } from "../hooks/useFlashIds";
import { useOpenOrders } from "../hooks/useOpenOrders";
import { MenuCategory } from "../types";
import { notifyError } from "../utils";

const checkCategory = async (orderId: string, categoryName: string, value: boolean) => {
  try {
    // FieldPath preserves category names containing dots.
    await updateDoc(doc(db, "orders", orderId), new FieldPath("categories", categoryName, "done"), value);
  } catch (error) {
    notifyError(`Failed to update ${categoryName}`, error);
  }
};

export function PrepPage({ menu }: { menu: MenuCategory[] }) {
  const allCategories = menu.map((category) => category.categoryName);
  // Store hidden rather than shown categories so new categories are shown by default.
  const [hidden, setHidden] = useLocalStorage<string[]>({
    key: "anicafe-prep-hidden-categories",
    defaultValue: [],
    getInitialValueInEffect: false,
  });
  const categories = allCategories.filter((name) => !hidden.includes(name));

  const { orders, error } = useOpenOrders();
  // Track all open orders so changing the selection doesn't flash existing orders as new.
  const { flashIds: newIds, dismiss } = useFlashIds(orders?.map((order) => order.id) ?? null, {
    durationMs: 10_000,
  });
  const shownOrders = orders?.filter((order) => categories.some((name) => name in order.categories)) ?? null;

  let content;
  if (error) content = <ErrorState title="Failed to load orders" message={error} />;
  else if (shownOrders === null) content = <LoadingState label="Loading orders..." />;
  else if (categories.length === 0)
    content = <EmptyState title="No categories selected">Turn on a category above to see its orders.</EmptyState>;
  else if (shownOrders.length === 0)
    content = <EmptyState title="No open orders">Orders from the cashier will appear here.</EmptyState>;
  else
    content = (
      <OrderGrid>
        {shownOrders.map((order) => (
          <OrderCard
            key={order.id}
            flash={newIds.has(order.id) ? "new" : undefined}
            onInteract={() => dismiss(order.id)}
            order={order}
            categories={categories}
            menu={menu}
            completeCategory={checkCategory}
          />
        ))}
      </OrderGrid>
    );

  return (
    <Stack>
      {allCategories.length > 1 && (
        <Group gap="sm">
          <Text fw={600}>Show</Text>
          <Chip size="md" checked={categories.length === allCategories.length} onChange={() => setHidden([])}>
            All
          </Chip>
          <Chip.Group
            multiple
            value={categories}
            onChange={(shown) => setHidden(allCategories.filter((name) => !shown.includes(name)))}
          >
            {allCategories.map((name) => (
              <Chip key={name} size="md" value={name}>
                {name}
              </Chip>
            ))}
          </Chip.Group>
        </Group>
      )}
      {content}
    </Stack>
  );
}
