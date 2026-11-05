import { useEffect, useMemo, useState } from "react";
import { doc, runTransaction } from "firebase/firestore";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { EmptyState } from "../components/StatusMessage";
import { db } from "../firebase";
import { menuCategoryFromDoc } from "../fromFirestore";
import { MenuCategory, MenuItem, StockLevel } from "../types";
import { notifyError, toCents } from "../utils";

/** Prices remain in dollars while editing and are converted to cents on save. */
interface EditableMenuItem extends Omit<MenuItem, "flags" | "priceCents"> {
  /** Stays fixed while the name is edited so dragging can track the row. Never saved. */
  dragId: string;
  price: number | string;
  flags: string[];
}

let lastDragId = 0;
const newDragId = () => String(++lastDragId);

interface EditableMenuCategory {
  categoryName: string;
  items: EditableMenuItem[];
}

const FLAG_MEANINGS: Record<string, string> = {
  NF: "Nut Free",
  DF: "Dairy Free",
  GF: "Gluten Free",
  VG: "Vegan",
  "*": "Contains Pork (e.g. gelatin)",
};
const STANDARD_FLAGS = Object.keys(FLAG_MEANINGS);

const sameFlag = (a: string) => (b: string) => a.toLowerCase() === b.toLowerCase();

/** Reuse existing flag spelling for case-insensitive matches. */
const normalizeFlags = (flags: string[], known: string[]) =>
  flags
    .map((flag) => flag.trim())
    .filter((flag) => flag !== "")
    .map((flag) => known.find(sameFlag(flag)) ?? flag)
    .filter((flag, i, all) => all.findIndex(sameFlag(flag)) === i);

/** Fixed widths keep a dragged row's cells lined up with the table. */
const ITEM_COLUMNS = { handle: 40, price: 130, stock: 110, flags: 260, remove: 100 };

const STOCK_OPTIONS = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

/** Compare editor values without drag identity or category position. */
const toMenuValues = (menu: (MenuCategory | EditableMenuCategory)[]) =>
  menu.map(({ categoryName, items }) => ({
    categoryName,
    items: items.map((item) => ({
      itemName: item.itemName,
      price: "price" in item ? item.price : item.priceCents / 100,
      stock: item.stock,
      flags: item.flags ?? [],
    })),
  }));

const toEditable = (menu: MenuCategory[]): EditableMenuCategory[] =>
  toMenuValues(menu).map((category) => ({
    ...category,
    items: category.items.map((item) => ({ ...item, dragId: newDragId() })),
  }));

const fromEditable = (items: EditableMenuItem[]): MenuItem[] =>
  items.map(({ itemName, price, stock, flags }) => ({
    itemName: itemName.trim(),
    priceCents: toCents(price),
    stock,
    flags,
  }));

const newItem = (): EditableMenuItem => ({
  dragId: newDragId(),
  itemName: "New Item",
  price: 0,
  stock: "high",
  flags: [],
});

/** Category names are used as Firestore document IDs. */
function categoryNameError(name: string, existing: EditableMenuCategory[]) {
  if (!name) return "Enter a category name";
  if (name.includes("/") || name === "." || name === ".." || /^__.*__$/.test(name))
    return 'Category names can\'t contain "/"';
  if (existing.some((category) => category.categoryName.toLowerCase() === name.toLowerCase()))
    return `There's already a ${name} category`;
  return null;
}

const sameMenu = (a: (MenuCategory | EditableMenuCategory)[], b: (MenuCategory | EditableMenuCategory)[]) =>
  JSON.stringify(toMenuValues(a)) === JSON.stringify(toMenuValues(b));

const sameCategory = (a: MenuCategory, b: MenuCategory) =>
  a.position === b.position && sameMenu([a], [b]);

/** The editor's array order becomes each category's saved position. */
const toSavedMenu = (menu: EditableMenuCategory[]): MenuCategory[] =>
  menu.map((category, position) => ({
    categoryName: category.categoryName,
    position,
    items: fromEditable(category.items),
  }));

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

function menuError(menu: MenuCategory[]) {
  const invalid = menu.find((category) => {
    const names = category.items.map((item) => item.itemName);
    return names.some((name) => !name) || new Set(names).size !== names.length;
  });
  return invalid ? `Item names in ${invalid.categoryName} must be nonempty and unique.` : null;
}

/** Match by name because adding a category changes array positions. */
const changedCategories = (menu: MenuCategory[], base: MenuCategory[]) =>
  menu.filter((category) => {
    const original = base.find((c) => c.categoryName === category.categoryName);
    return !original || !sameCategory(category, original);
  });

const removedCategories = (menu: MenuCategory[], base: MenuCategory[]) =>
  base.filter((original) => !menu.some((category) => category.categoryName === original.categoryName));

function conflictError(categoryName: string, base: MenuCategory | undefined, current: MenuCategory | undefined) {
  if (!base) return current ? `A ${categoryName} category was added on another device.` : null;
  return current && sameCategory(current, base) ? null : `${categoryName} changed on another device.`;
}

/** The mounted editor uses `active` to lock when the tab is left. */
export function EditMenuPage({ menu, active }: { menu: MenuCategory[]; active: boolean }) {
  // Keep the original menu for conflict detection.
  const [baseMenu, setBaseMenu] = useState(menu);
  const [editedMenu, setEditedMenu] = useState(() => toEditable(menu));
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);

  const customFlags = useMemo(() => {
    const used = editedMenu.flatMap((category) => category.items.flatMap((item) => item.flags));
    return [...new Set(used)].filter((flag) => !STANDARD_FLAGS.includes(flag)).sort();
  }, [editedMenu]);
  const flagOptions = useMemo(() => [...STANDARD_FLAGS, ...customFlags], [customFlags]);

  const hasUnsavedChanges = useMemo(() => !sameMenu(editedMenu, baseMenu), [editedMenu, baseMenu]);

  if (menu !== baseMenu && !hasUnsavedChanges) {
    setBaseMenu(menu);
    setEditedMenu(toEditable(menu));
  }

  // Preserve access to unsaved edits when the tab is hidden.
  useEffect(() => {
    if (!active && !hasUnsavedChanges) setLocked(true);
  }, [active, hasUnsavedChanges]);

  const confirmUnlock = () =>
    modals.openConfirmModal({
      title: "Unlock menu editing?",
      children: (
        <Text size="sm">
          Saved changes go live on every station right away, including the cashier. The editor locks again after you
          save or leave this tab.
        </Text>
      ),
      labels: { confirm: "Unlock", cancel: "Cancel" },
      confirmProps: { color: "orange" },
      onConfirm: () => setLocked(false),
    });

  const changedElsewhere = menu !== baseMenu && !saving && !sameMenu(menu, baseMenu);

  const discardEdits = () => {
    setBaseMenu(menu);
    setEditedMenu(toEditable(menu));
  };

  const updateItems = (catIndex: number, update: (items: EditableMenuItem[]) => EditableMenuItem[]) =>
    setEditedMenu((prev) =>
      prev.map((category, i) => (i === catIndex ? { ...category, items: update(category.items) } : category)),
    );

  const handleItemChange = <K extends keyof EditableMenuItem>(
    catIndex: number,
    itemIndex: number,
    field: K,
    value: EditableMenuItem[K],
  ) => updateItems(catIndex, (items) => items.map((item, j) => (j === itemIndex ? { ...item, [field]: value } : item)));

  const handleAddItem = (catIndex: number) => updateItems(catIndex, (items) => [...items, newItem()]);
  const isUnsavedCategory = (categoryName: string) => !baseMenu.some((c) => c.categoryName === categoryName);

  const handleAddCategory = () => {
    const categoryName = newCategoryName.trim();
    const error = categoryNameError(categoryName, editedMenu);
    setNewCategoryError(error);
    if (error) return;
    setEditedMenu((prev) => [...prev, { categoryName, items: [newItem()] }]);
    setNewCategoryName("");
  };

  const removeCategory = (categoryName: string) =>
    setEditedMenu((prev) => prev.filter((category) => category.categoryName !== categoryName));

  const handleRemoveCategory = (categoryName: string) =>
    isUnsavedCategory(categoryName)
      ? removeCategory(categoryName)
      : modals.openConfirmModal({
          title: `Remove ${categoryName}?`,
          children: (
            <Text size="sm">
              {categoryName} and its items leave the menu when you save. Past orders keep them, but open orders with{" "}
              {categoryName} will no longer show it on the Prep tab.
            </Text>
          ),
          labels: { confirm: "Remove", cancel: "Cancel" },
          confirmProps: { color: "red" },
          onConfirm: () => removeCategory(categoryName),
        });

  const handleCategoryDrop = ({ source, destination }: DropResult) => {
    if (destination && destination.index !== source.index)
      setEditedMenu((prev) => move(prev, source.index, destination.index));
  };

  const handleItemDrop =
    (catIndex: number) =>
    ({ source, destination }: DropResult) => {
      if (destination && destination.index !== source.index)
        updateItems(catIndex, (items) => move(items, source.index, destination.index));
    };

  const handleRemoveItem = (catIndex: number, itemIndex: number) =>
    updateItems(catIndex, (items) => items.filter((_, j) => j !== itemIndex));

  const handleSaveMenu = async () => {
    const savedMenu = toSavedMenu(editedMenu);
    const invalid = menuError(savedMenu);
    if (invalid) {
      notifyError("Invalid menu", invalid);
      return;
    }
    const writes = [
      ...changedCategories(savedMenu, baseMenu).map((next) => ({ categoryName: next.categoryName, next })),
      ...removedCategories(savedMenu, baseMenu).map(({ categoryName }) => ({ categoryName, next: undefined })),
    ];
    if (writes.length === 0) return;
    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const refs = writes.map(({ categoryName }) => doc(db, "menu", categoryName));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const conflict = writes
          .map(({ categoryName }, i) =>
            conflictError(
              categoryName,
              baseMenu.find((category) => category.categoryName === categoryName),
              snapshots[i].exists() ? menuCategoryFromDoc(snapshots[i]) : undefined,
            ),
          )
          .find((error) => error !== null);
        if (conflict) throw new Error(`${conflict} Discard your edits and try again.`);
        writes.forEach(({ next }, i) => (next ? transaction.set(refs[i], next) : transaction.delete(refs[i])));
      });
      setBaseMenu(savedMenu);
      setEditedMenu(toEditable(savedMenu));
      setLocked(true);
      modals.open({ title: "Menu Saved", children: <p>Menu successfully updated!</p> });
    } catch (error) {
      notifyError("Failed to save menu", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack>
      <Card shadow="sm" radius="md" p="md">
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={2}>Edit Menu</Title>
            {locked && (
              <Badge color="gray" variant="light" size="lg">
                Locked
              </Badge>
            )}
          </Group>
          {locked ? (
            <Button variant="default" onClick={confirmUnlock}>
              Unlock to edit
            </Button>
          ) : (
            <Group gap="xs">
              <Button
                variant="default"
                onClick={() => setLocked(true)}
                disabled={hasUnsavedChanges || saving}
                title={hasUnsavedChanges ? "Save your changes first" : undefined}
              >
                Lock
              </Button>
              <Button onClick={handleSaveMenu} loading={saving} color={hasUnsavedChanges ? "yellow" : "blue"}>
                {hasUnsavedChanges ? "Save Changes *" : "Save Changes"}
              </Button>
            </Group>
          )}
        </Group>
      </Card>

      <fieldset
        disabled={saving || locked}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--mantine-spacing-md)",
        }}
      >
        {changedElsewhere && (
          <Alert color="orange" title="The menu was changed on another device">
            <Group justify="space-between">
              <Text size="sm">
                If you edited the same category, saving will be rejected. Discard your edits to load the latest menu.
              </Text>
              <Button size="xs" variant="outline" color="orange" onClick={discardEdits}>
                Discard my edits and load latest
              </Button>
            </Group>
          </Alert>
        )}

        <Card shadow="sm" radius="md" p="md" withBorder>
          <Title order={4} mb="xs">
            Flag Legend
          </Title>
          <List spacing="xs" size="sm" withPadding>
            {Object.entries(FLAG_MEANINGS).map(([flag, meaning]) => (
              <List.Item key={flag}>
                <Text span fw={700}>
                  {flag}
                </Text>{" "}
                – {meaning}
              </List.Item>
            ))}
          </List>
          {customFlags.length > 0 && (
            <Text size="sm" mt="xs">
              Other flags on this menu:{" "}
              <Text span fw={700}>
                {customFlags.join(", ")}
              </Text>
            </Text>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            To add a new flag, type it into an item&apos;s Flags box and press Enter. It&apos;s then offered for every
            item.
          </Text>
        </Card>

        {editedMenu.length === 0 && (
          <EmptyState title="The menu is empty">
            Add a category below (e.g. Food, Drinks, Desserts) to start.
          </EmptyState>
        )}

        {editedMenu.length > 1 && (
          <Card shadow="sm" radius="md" p="md" withBorder>
            <Title order={4}>Category Order</Title>
            <Text size="sm" c="dimmed" mb="sm">
              {locked ? "Unlock to change the order." : "Drag categories to set their order on every tab, then save."}
            </Text>
            <DragDropContext onDragEnd={handleCategoryDrop}>
              <Droppable droppableId="category-order">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {editedMenu.map((category, index) => (
                      <Draggable
                        key={category.categoryName}
                        draggableId={category.categoryName}
                        index={index}
                        isDragDisabled={locked || saving}
                      >
                        {(provided, snapshot) => (
                          <Paper
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            withBorder
                            shadow={snapshot.isDragging ? "md" : undefined}
                            p="xs"
                            mb="xs"
                            aria-label={`${category.categoryName}, position ${index + 1}`}
                            style={{
                              ...provided.draggableProps.style,
                              cursor: locked || saving ? "default" : "grab",
                              opacity: locked ? 0.6 : 1,
                            }}
                          >
                            <Group gap="sm" wrap="nowrap">
                              <Text c="dimmed" aria-hidden style={{ userSelect: "none" }}>
                                ⠿
                              </Text>
                              <Text c="dimmed" w={24}>
                                {index + 1}.
                              </Text>
                              <Text fw={500}>{category.categoryName}</Text>
                            </Group>
                          </Paper>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </Card>
        )}

        {editedMenu.map((category, catIndex) => (
          <Card key={category.categoryName} shadow="sm" radius="md" p="md">
            <Group justify="space-between" mb="sm">
              <Title order={4}>{category.categoryName}</Title>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => handleRemoveCategory(category.categoryName)}
                >
                  Remove category
                </Button>
                <Button size="xs" onClick={() => handleAddItem(catIndex)}>
                  + Add Item
                </Button>
              </Group>
            </Group>
            <Table.ScrollContainer minWidth={800}>
              <DragDropContext onDragEnd={handleItemDrop(catIndex)}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={ITEM_COLUMNS.handle}>
                        <VisuallyHidden>Reorder</VisuallyHidden>
                      </Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th w={ITEM_COLUMNS.price}>Price</Table.Th>
                      <Table.Th w={ITEM_COLUMNS.stock}>Stock</Table.Th>
                      <Table.Th w={ITEM_COLUMNS.flags}>Flags</Table.Th>
                      <Table.Th w={ITEM_COLUMNS.remove}>Remove</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Droppable droppableId={`items-${category.categoryName}`}>
                    {(provided) => (
                      <Table.Tbody ref={provided.innerRef} {...provided.droppableProps}>
                        {category.items.map((item, itemIndex) => (
                          <Draggable
                            key={item.dragId}
                            draggableId={item.dragId}
                            index={itemIndex}
                            isDragDisabled={locked || saving}
                          >
                            {(provided, snapshot) => (
                              <Table.Tr
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                style={{
                                  ...provided.draggableProps.style,
                                  // The dragged row leaves the table, so give it a background and keep it full width.
                                  ...(snapshot.isDragging && {
                                    display: "table",
                                    tableLayout: "fixed",
                                    background: "var(--mantine-color-body)",
                                    boxShadow: "var(--mantine-shadow-md)",
                                  }),
                                }}
                              >
                                <Table.Td w={ITEM_COLUMNS.handle}>
                                  <Text
                                    {...provided.dragHandleProps}
                                    aria-label={`Move ${item.itemName}, position ${itemIndex + 1}`}
                                    c="dimmed"
                                    ta="center"
                                    style={{ cursor: locked || saving ? "default" : "grab", userSelect: "none" }}
                                  >
                                    ⠿
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  <TextInput
                                    value={item.itemName}
                                    onChange={(e) =>
                                      handleItemChange(catIndex, itemIndex, "itemName", e.currentTarget.value)
                                    }
                                  />
                                </Table.Td>
                                <Table.Td w={ITEM_COLUMNS.price}>
                                  <NumberInput
                                    value={item.price}
                                    min={0}
                                    prefix="$"
                                    decimalScale={2}
                                    fixedDecimalScale
                                    onChange={(val) => handleItemChange(catIndex, itemIndex, "price", val)}
                                  />
                                </Table.Td>
                                <Table.Td w={ITEM_COLUMNS.stock}>
                                  <Select
                                    value={item.stock}
                                    data={STOCK_OPTIONS}
                                    onChange={(val) =>
                                      handleItemChange(catIndex, itemIndex, "stock", (val ?? "none") as StockLevel)
                                    }
                                  />
                                </Table.Td>
                                <Table.Td w={ITEM_COLUMNS.flags}>
                                  <TagsInput
                                    aria-label={`Flags for ${item.itemName}`}
                                    placeholder={item.flags.length === 0 ? "Pick or type a flag" : undefined}
                                    data={flagOptions}
                                    value={item.flags}
                                    onChange={(flags) =>
                                      handleItemChange(catIndex, itemIndex, "flags", normalizeFlags(flags, flagOptions))
                                    }
                                    renderOption={({ option }) =>
                                      FLAG_MEANINGS[option.value] ? (
                                        <Text size="sm">
                                          <Text span fw={700}>
                                            {option.value}
                                          </Text>{" "}
                                          – {FLAG_MEANINGS[option.value]}
                                        </Text>
                                      ) : (
                                        <Text size="sm" fw={700}>
                                          {option.value}
                                        </Text>
                                      )
                                    }
                                    splitChars={[","]}
                                    acceptValueOnBlur
                                    clearable
                                  />
                                </Table.Td>
                                <Table.Td w={ITEM_COLUMNS.remove}>
                                  <Button color="red" size="xs" onClick={() => handleRemoveItem(catIndex, itemIndex)}>
                                    Remove
                                  </Button>
                                </Table.Td>
                              </Table.Tr>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </Table.Tbody>
                    )}
                  </Droppable>
                </Table>
              </DragDropContext>
            </Table.ScrollContainer>
          </Card>
        ))}

        <Card shadow="sm" radius="md" p="md" withBorder>
          <Group align="flex-start">
            <TextInput
              label="New category"
              placeholder="e.g. Desserts"
              value={newCategoryName}
              error={newCategoryError}
              onChange={(e) => {
                setNewCategoryName(e.currentTarget.value);
                setNewCategoryError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory();
              }}
              style={{ flexGrow: 1 }}
            />
            <Button mt={25} onClick={handleAddCategory}>
              + Add Category
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            New categories are added to the end of the order, saved with Save Changes, and appear on the Prep tab of
            every device.
          </Text>
        </Card>
      </fieldset>
    </Stack>
  );
}
