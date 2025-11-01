import { Fragment, useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  setDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  where,
  serverTimestamp,
  orderBy,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  List,
  NumberInput,
  NumberInputHandlers,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Transition,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import "./App.css";
import "@mantine/core/styles.css";
import classes from "./App.module.css";
import { modals } from "@mantine/modals";
import { hideNotification, notifications } from "@mantine/notifications";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
};

// Initialize Firebase
const firebaseapp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseapp);

const formatPrice = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

interface MenuItem {
  itemName: string;
  price: number;
  stock: "high" | "low" | "none";
  flags?: string[];
}

interface EditableMenuItem extends MenuItem {
  flagsString: string; // temporary string representation for editing
}

interface MenuCategory {
  categoryName: string;
  items: MenuItem[];
}

interface EditableMenuCategory {
  categoryName: string;
  items: EditableMenuItem[];
}

interface Order {
  id?: string;
  timestamp?: Timestamp;
  specialtyOnly?: boolean;
  zone?: string;
  number: number;
  price: number;
  discount: number;
  notes: string;
  completed: boolean;
  categories: { [categoryName: string]: { done: boolean; items: { [itemName: string]: { quantity: number } } } };
}

interface Specialty {
  id: string;
  number: number;
  notes: string;
  done: boolean;
  timestamp: Timestamp;
  items: { [itemName: string]: { quantity: number } };
}

const zoneToColor = (zone: string) => {
  switch (zone) {
    case "Bar":
      return "indigo";
    case "Cashier":
      return "purple";
    case "Stage":
      return "orange";
    case "Undecided":
      return "gray";
    case "Volunteer":
      return "teal";
    default:
      return "gray";
  }
}

function OrderCard({
  order,
  excludeCategories,
  completeOrder,
  completeCategory,
}: {
  order: Order;
  excludeCategories?: string[];
  completeOrder?: () => Promise<void>;
  completeCategory?: "view" | ((orderId: string, categoryName: string, value: boolean) => Promise<void>);
}) {
  return (
    <Card shadow="sm" radius="md" p="md" style={{ height: "420px", display: "flex", flexDirection: "column" }}>
      <Card.Section withBorder>
        <Group style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "36px" }}>
          <Group>
            <Title order={3}>Order #{order.number}</Title>
            {order.zone && (
              <Badge color={zoneToColor(order.zone)}>
                {order.zone}
              </Badge>
            )}
          </Group>
          {completeOrder && <Button onClick={completeOrder}>Complete</Button>}
        </Group>
        {order.notes && (
          <Text lineClamp={3} style={{ overflow: "auto", overflowWrap: "break-word", marginTop: "8px" }}>
            {`Notes: ${order.notes}`}
          </Text>
        )}
      </Card.Section>
      <Card.Section style={{ overflow: "auto" }}>
        <Table>
          <Table.Tbody>
            {Object.entries(order.categories)
              .sort()
              .map(([categoryName, category]) =>
                excludeCategories?.includes(categoryName) ? (
                  <Fragment key={categoryName}></Fragment>
                ) : (
                  <Fragment key={categoryName}>
                    <Table.Tr style={{ tableLayout: "fixed" }}>
                      <Table.Th>
                        <Title order={5}>{categoryName}</Title>
                      </Table.Th>
                      {completeCategory && order.id && (
                        <Table.Th style={{ display: "flex", justifyContent: "center", width: "40px" }}>
                          <Checkbox
                            checked={category.done}
                            onChange={
                              completeCategory === "view"
                                ? () => {}
                                : (e) => completeCategory(order.id!, categoryName, e.currentTarget.checked)
                            }
                          />
                        </Table.Th>
                      )}
                    </Table.Tr>
                    {Object.entries(category.items)
                      .sort()
                      .map(([itemName, item]) => (
                        <Table.Tr key={itemName}>
                          <Table.Td style={{ textAlign: "left" }}>{itemName}</Table.Td>
                          <Table.Td style={{ textAlign: "center", width: "40px" }}>{item.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                  </Fragment>
                )
              )}
          </Table.Tbody>
        </Table>
      </Card.Section>
    </Card>
  );
}

function OrderPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const unsubscribeOrders = onSnapshot(
      query(
        collection(db, "orders"),
        where("completed", "==", false),
        where("specialtyOnly", "==", false),
        orderBy("timestamp")
      ),
      (snapshot) => {
        const ordersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
        setOrders(ordersData);
      }
    );

    return () => {
      unsubscribeOrders();
    };
  }, []);

  const checkCategory = async (orderId: string, categoryName: string, value: boolean) => {
    await updateDoc(doc(db, "orders", orderId), {
      [`categories.${categoryName}.done`]: value,
    });
  };

  return (
    <Stack>
      <SimpleGrid cols={{ sm: 2, lg: 3 }} spacing="sm" verticalSpacing="sm">
        {orders.map((order) => (
          <Fragment key={order.id}>
            <OrderCard order={order} excludeCategories={["Specialty"]} completeCategory={checkCategory} />
          </Fragment>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function ServerPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const unsubscribeOrders = onSnapshot(
      query(
        collection(db, "orders"),
        where("completed", "==", false),
        where("specialtyOnly", "==", false),
        orderBy("timestamp")
      ),
      (snapshot) => {
        const ordersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
        setOrders(ordersData);
      }
    );

    return () => {
      unsubscribeOrders();
    };
  }, []);

  const completeOrder = async (orderId: string, orderNumber: number) => {
    await updateDoc(doc(db, "orders", orderId), {
      completed: true,
    });
    notifications.show({
      id: orderId,
      message: (
        <Group justify="space-between">
          {`Order #${orderNumber} completed!`}
          <Button
            variant="outline"
            onClick={async () => {
              await updateDoc(doc(db, "orders", orderId), {
                completed: false,
              });
              hideNotification(orderId);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
      autoClose: 8000,
    });
  };

  return (
    <Stack>
      <SimpleGrid cols={{ sm: 2, lg: 3 }} spacing="sm" verticalSpacing="sm">
        {orders.map((order) => (
          <Fragment key={order.id}>
            <OrderCard
              order={order}
              excludeCategories={["Specialty"]}
              completeOrder={() =>
                completeOrder(
                  order.id!, // not null because fetched from db
                  order.number
                )
              }
              completeCategory="view"
            />
          </Fragment>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function CashierPage({ menu, submitOrder }: { menu: MenuCategory[]; submitOrder: (order: Order) => Promise<void> }) {
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      number: null,
      notes: "",
      discount: 0,
      zone: "Undecided",
      items: Object.fromEntries(
        menu.map((category) => [
          category.categoryName,
          Object.fromEntries(category.items.map((item) => [item.itemName, 0])),
        ])
      ),
    },
    onValuesChange: (values) => {
      setTotal(calculateTotal(values.items) - values.discount);
    },
    validate: {
      number: (value: number | null) => (value && value > 0 ? null : "Order number is required"),
      discount: () => (total >= 0 ? null : "Discount greater than order total"),
    },
  });

  const handleSubmit = (values: typeof form.values) => {
    const newOrder = makeOrder(values);
    modals.openConfirmModal({
      title: "Review Order",
      children: (
        <Stack>
          <Text size="sm">Please confirm that the order details are correct:</Text>
          <OrderCard order={newOrder} />
        </Stack>
      ),
      labels: { confirm: "Confirm", cancel: "Cancel" },
      onCancel: () => {},
      onConfirm: () => {
        submitOrder(newOrder);
        form.reset();
      },
    });
  };

  const itemPriceMap = Object.fromEntries(
    menu.map((category) => [
      category.categoryName,
      Object.fromEntries(category.items.map((item) => [item.itemName, item.price])),
    ])
  );

  const calculateTotal = (categoires: Record<string, Record<string, number>>) => {
    return Object.entries(categoires).reduce(
      (sum, [categoryName, category]) =>
        sum +
        Object.entries(category).reduce(
          (sum, [itemName, quantity]) => sum + itemPriceMap[categoryName][itemName] * quantity,
          0
        ),
      0
    );
  };

  const makeOrder = (formValues: typeof form.values): Order => ({
    number: formValues.number ?? 0, // 0 case should not happen due to validation
    price: total,
    discount: formValues.discount,
    notes: formValues.notes,
    completed: false,
    zone: formValues.zone,
    categories: Object.fromEntries(
      // Map formValues to Order.categories :skull:
      Object.entries(formValues.items).reduce(
        (categories: [string, Order["categories"][string]][], [categoryName, category]) => {
          const newCategory = {
            done: false,
            items: Object.fromEntries(
              Object.entries(category).reduce(
                (items: [string, Order["categories"][string]["items"][string]][], [itemName, quantity]) =>
                  quantity > 0 ? [...items, [itemName, { quantity }]] : items,
                []
              )
            ),
          };
          return Object.keys(newCategory.items).length > 0 ? [...categories, [categoryName, newCategory]] : categories;
        },
        []
      )
    ),
  });

  const [total, setTotal] = useState(0);

  const handlersRef = useRef<(NumberInputHandlers | null | undefined)[][]>(
    menu.map((category) => category.items.map(() => null))
  );

  const PAGE_ROWS = 2;

  return (
    <Card shadow="sm" radius="md" p="md">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Card.Section withBorder>
          <Title order={2}>Create Order</Title>
        </Card.Section>
        <Card.Section withBorder>
          <SimpleGrid cols={PAGE_ROWS}>
            {Array.from(Array(PAGE_ROWS)).map((_, rowNum) => (
              <Table key={rowNum}>
                <Table.Tbody>
                  {menu.map(
                    (category, i) =>
                      i % PAGE_ROWS === rowNum && (
                        <Fragment key={category.categoryName}>
                          <Table.Tr style={{ display: "flex", padding: `${i / PAGE_ROWS < 1 ? "0" : "12px"} 0 4px 0` }}>
                            <Table.Td display="flex">
                              <Title order={4}>{category.categoryName}</Title>
                            </Table.Td>
                          </Table.Tr>
                          {category.items.map((item, j) => {
                            const formName = "items." + category.categoryName + "." + item.itemName;
                            return (
                              <Table.Tr key={item.itemName} className={classes.flexRow}>
                                <Table.Td className={classes.flexGrow}>{item.itemName}</Table.Td>
                                <Table.Td className={classes.cashPriceContainer}>{formatPrice(item.price)}</Table.Td>
                                <Table.Td className={classes.numberButtonContainer}>
                                  <Button.Group>
                                    <Transition
                                      mounted={form.getValues().items[category.categoryName][item.itemName] !== 0}
                                      keepMounted
                                      transition="slide-left"
                                      duration={200}
                                      timingFunction="ease"
                                    >
                                      {(styles) => (
                                        <>
                                          <Button
                                            variant="default"
                                            onClick={() => handlersRef.current[i][j]?.decrement()}
                                            style={styles}
                                          >
                                            -
                                          </Button>
                                          <NumberInput
                                            style={styles}
                                            classNames={{
                                              input: classes.numberButtonInput,
                                            }}
                                            hideControls
                                            handlersRef={(el) => (handlersRef.current[i][j] = el)}
                                            min={0}
                                            max={99}
                                            key={form.key(formName)}
                                            {...form.getInputProps(formName)}
                                          />
                                        </>
                                      )}
                                    </Transition>
                                    <Button variant="default" onClick={() => handlersRef.current[i][j]?.increment()}>
                                      +
                                    </Button>
                                  </Button.Group>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Fragment>
                      )
                  )}
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
              min={0}
              key={form.key("number")}
              {...form.getInputProps("number")}
            />
            <NumberInput
              label="Apply Discount"
              min={0}
              key={form.key("discount")}
              decimalScale={2}
              fixedDecimalScale={true}
              thousandSeparator=","
              prefix="$"
              {...form.getInputProps("discount")}
            />
            <Select
              label="Seating Zone"
              allowDeselect={false}
              data={["Bar", "Cashier", "Stage", "Undecided", "Volunteer"]}
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
          <Group>
            <Text>Order Total: {formatPrice(total)}</Text>
            <Button type="submit">Submit</Button>
          </Group>
        </Card.Section>
      </form>
    </Card>
  );
}

function SpecialtyPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  useEffect(() => {
    const unsubscribeSpecialties = onSnapshot(
      query(collection(db, "specialty"), where("done", "==", false), orderBy("timestamp")),
      (snapshot) => {
        setSpecialties(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Specialty)));
      }
    );

    return () => unsubscribeSpecialties();
  }, []);

  const completeSpecialtyOrder = async (orderId: string, orderNumber: number) => {
    await Promise.all([
      updateDoc(doc(db, "specialty", orderId), {
        done: true,
      }),
      updateDoc(doc(db, "orders", orderId), {
        ["categories.Specialty.done"]: true,
      }),
    ]);
    notifications.show({
      id: orderId + "specialty",
      message: (
        <Group justify="space-between">
          {`Specialty order #${orderNumber} completed!`}
          <Button
            variant="outline"
            onClick={async () => {
              await Promise.all([
                updateDoc(doc(db, "specialty", orderId), {
                  done: false,
                }),
                updateDoc(doc(db, "orders", orderId), {
                  ["categories.Specialty.done"]: false,
                }),
              ]);
              hideNotification(orderId + "specialty");
            }}
          >
            Undo
          </Button>
        </Group>
      ),
      autoClose: 8000,
    });
  };

  return (
    <Stack>
      <SimpleGrid cols={{ sm: 2, lg: 3 }} spacing="sm" verticalSpacing="sm">
        {specialties.map((specialty) => (
          <Fragment key={specialty.id}>
            <OrderCard
              order={{
                id: specialty.id,
                number: specialty.number,
                completed: specialty.done,
                notes: specialty.notes,
                price: 0,
                discount: 0,
                categories: { Specialty: { done: false, items: specialty.items } },
              }}
              completeOrder={() => completeSpecialtyOrder(specialty.id, specialty.number)}
            />
          </Fragment>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function EditMenuPage({ menu }: { menu: MenuCategory[] }) {
  const [editedMenu, setEditedMenu] = useState<EditableMenuCategory[]>(
    menu.map((cat) => ({
      categoryName: cat.categoryName,
      items: cat.items.map((it) => ({
        ...it,
        flagsString: (it.flags || []).join(", "),
      })),
    }))
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    setEditedMenu(
      menu.map((cat) => ({
        categoryName: cat.categoryName,
        items: cat.items.map((it) => ({
          ...it,
          flagsString: (it.flags || []).join(", "),
        })),
      }))
    );
    setHasUnsavedChanges(false);
  }, [menu]);

  // Detect unsaved changes
  useEffect(() => {
    const normalize = (m: EditableMenuCategory[]) =>
      JSON.stringify(
        m.map((cat) => ({
          categoryName: cat.categoryName,
          items: cat.items.map((it) => ({
            itemName: it.itemName,
            price: it.price,
            stock: it.stock,
            flagsString: it.flagsString,
          })),
        }))
      );
    setHasUnsavedChanges(normalize(editedMenu) !== normalize(
      menu.map((cat) => ({
        categoryName: cat.categoryName,
        items: cat.items.map((it) => ({
          itemName: it.itemName,
          price: it.price,
          stock: it.stock,
          flagsString: (it.flags || []).join(", "),
        })),
      }))
    ));
  }, [editedMenu, menu]);

  const handleItemChange = (
    catIndex: number,
    itemIndex: number,
    field: keyof EditableMenuItem,
    value: string | number
  ) => {
    setEditedMenu((prev) =>
      prev.map((cat, i) =>
        i === catIndex
          ? {
              ...cat,
              items: cat.items.map((item, j) =>
                j === itemIndex ? { ...item, [field]: value } : item
              ),
            }
          : cat
      )
    );
  };

  const handleAddItem = (catIndex: number) => {
    setEditedMenu((prev) =>
      prev.map((cat, i) =>
        i === catIndex
          ? {
              ...cat,
              items: [
                ...cat.items,
                { itemName: "New Item", price: 0, stock: "high", flags: [], flagsString: "" },
              ],
            }
          : cat
      )
    );
  };

  const handleRemoveItem = (catIndex: number, itemIndex: number) => {
    setEditedMenu((prev) =>
      prev.map((cat, i) =>
        i === catIndex
          ? { ...cat, items: cat.items.filter((_, j) => j !== itemIndex) }
          : cat
      )
    );
  };

  const handleSaveMenu = async () => {
  try {
    const batch = writeBatch(db);

    // convert flagsString -> flags array on save
    editedMenu.forEach((category) => {
      const itemsForSave: MenuItem[] = category.items.map((it) => {
        const flags = it.flagsString
          ? it.flagsString.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        return {
          itemName: it.itemName,
          price: it.price,
          stock: it.stock,
          flags,
        };
      });

      const categoryRef = doc(db, "menu", category.categoryName);
      batch.set(categoryRef, {
        categoryName: category.categoryName,
        items: itemsForSave,
      });
    });

    await batch.commit();
    setHasUnsavedChanges(false);

    // Re-sync editedMenu: update both flags and flagsString
    setEditedMenu((prev) =>
      prev.map((cat) => ({
        ...cat,
        items: cat.items.map((it) => {
          const flags = it.flagsString
            ? it.flagsString.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          return { ...it, flags, flagsString: flags.join(", ") };
        }),
      }))
    );

    modals.open({
      title: "Menu Saved",
      children: <p>Your menu has been successfully updated!</p>,
    });
  } catch (error) {
    console.error("Error saving menu:", error);
    modals.open({
      title: "Error",
      children: <p>Failed to save menu. Check console for details.</p>,
    });
  }
};

  return (
    <Stack>
      <Card shadow="sm" radius="md" p="md">
        <Group justify="space-between">
          <Title order={2}>Edit Menu</Title>
          <Button onClick={handleSaveMenu} color={hasUnsavedChanges ? "yellow" : "blue"}>
            {hasUnsavedChanges ? "Save Changes *" : "Save Changes"}
          </Button>
        </Group>
      </Card>

      <Card shadow="sm" radius="md" p="md" withBorder>
        <Title order={4} mb="xs">
          Flag Legend
        </Title>
        <List spacing="xs" size="sm" withPadding>
          <List.Item>
            <Text span fw={700}>
              NF
            </Text>{" "}
            – Nut Free
          </List.Item>
          <List.Item>
            <Text span fw={700}>
              DF
            </Text>{" "}
            – Dairy Free
          </List.Item>
          <List.Item>
            <Text span fw={700}>
              GF
            </Text>{" "}
            – Gluten Free
          </List.Item>
          <List.Item>
            <Text span fw={700}>
              VG
            </Text>{" "}
            – Vegan
          </List.Item>
          <List.Item>
            <Text span fw={700}>
              *
            </Text>{" "}
            – Contains Pork (e.g. gelatin)
          </List.Item>
        </List>
      </Card>

      {editedMenu.map((category, catIndex) => (
        <Card key={category.categoryName} shadow="sm" radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>{category.categoryName}</Title>
            <Button size="xs" onClick={() => handleAddItem(catIndex)}>
              + Add Item
            </Button>
          </Group>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Price</Table.Th>
                <Table.Th>Stock</Table.Th>
                <Table.Th>Flags (e.g. NF, GF, VG)</Table.Th>
                <Table.Th>Remove</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {category.items.map((item: EditableMenuItem, itemIndex: number) => (
                <Table.Tr key={itemIndex}>
                  <Table.Td>
                    <TextInput
                      value={item.itemName}
                      onChange={(e) =>
                        handleItemChange(catIndex, itemIndex, "itemName", e.currentTarget.value)
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      value={item.price}
                      min={0}
                      decimalScale={2}
                      fixedDecimalScale
                      onChange={(val) =>
                        handleItemChange(catIndex, itemIndex, "price", val ?? 0)
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      value={item.stock}
                      data={[
                        { value: "high", label: "High" },
                        { value: "low", label: "Low" },
                        { value: "none", label: "None" },
                      ]}
                      onChange={(val) =>
                        handleItemChange(
                          catIndex,
                          itemIndex,
                          "stock",
                          (val ?? "none") as "high" | "low" | "none"
                        )
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    {/* Keep flags as an editable string while editing to allow commas */}
                    <TextInput
                      value={item.flagsString ?? (item.flags || []).join(", ")}
                      onChange={(e) =>
                        handleItemChange(catIndex, itemIndex, "flagsString", e.currentTarget.value)
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Button
                      color="red"
                      size="xs"
                      onClick={() => handleRemoveItem(catIndex, itemIndex)}
                    >
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}
    </Stack>
  );
}


function AllOrdersPage({ menu }: { menu: MenuCategory[] }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, "orders"), orderBy("timestamp")), (snapshot) => {
      let map: Record<string, number> = {
        "Total Orders": 0,
        "Total Items": 0,
        "Total Revenue": 0,
        ...Object.fromEntries(menu.flatMap((category) => category.items.map((item) => [item.itemName, 0]))),
      };
      setOrders(
        snapshot.docs.map((doc) => {
          const data = doc.data() as Order;
          map["Total Orders"]++;
          map["Total Revenue"] += data.price;
          Object.values(data.categories).forEach((category) => {
            Object.entries(category.items).forEach(([itemName, { quantity }]) => {
              map = { ...map, ["Total Items"]: map["Total Items"]+ quantity, [itemName]: (map[itemName] ?? 0) + quantity };
            });
          });
          return { id: doc.id, ...data } as Order;
        })
      );
      setAnalytics(map);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [menu]);

  const itemsToString = (items: Order["categories"][string]["items"] | undefined) => {
    if (items === undefined) return "-";

    return Object.entries(items)
      .sort()
      .map(([itemName, { quantity }]) => `${quantity} ${itemName}`)
      .join(", ");
  };

  if (loading) return <div>Loading orders...</div>;

  return (
    <Stack>
      <Title order={2}>Analytics</Title>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th>Quantity Sold</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Object.entries(analytics).map(([itemName, quantity]) => (
            <Table.Tr key={itemName}>
              <Table.Td>{itemName}</Table.Td>
              <Table.Td>{quantity}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Title order={2}>All Orders</Title>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Time</Table.Th>
            <Table.Th>Price</Table.Th>
            <Table.Th>Discount Applied</Table.Th>
            <Table.Th>Completed</Table.Th>
            <Table.Th>Notes</Table.Th>
            <Table.Th>Food</Table.Th>
            <Table.Th>Drinks</Table.Th>
            <Table.Th>Specialty</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orders.map((order) => (
            <Table.Tr key={order.id}>
              <Table.Td>{order.number}</Table.Td>
              <Table.Td>{order.timestamp?.toDate().toLocaleTimeString("en-US")}</Table.Td>
              <Table.Td>{formatPrice(order.price)}</Table.Td>
              <Table.Td>{formatPrice(order.discount)}</Table.Td>
              <Table.Td>{order.completed ? "Yes" : "No"}</Table.Td>
              <Table.Td>{order.notes}</Table.Td>
              <Table.Td>{itemsToString(order.categories["Food"]?.items)}</Table.Td>
              <Table.Td>{itemsToString(order.categories["Drinks"]?.items)}</Table.Td>
              <Table.Td>{itemsToString(order.categories["Specialty"]?.items)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function App() {
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeMenu = onSnapshot(query(collection(db, "menu"), orderBy("categoryName")), (snapshot) => {
      setMenu(snapshot.docs.map((doc) => doc.data() as MenuCategory));
      setLoading(false);
    });

    return () => unsubscribeMenu();
  }, []);

  const submitOrder = async (order: Order) => {
    const newOrder = {
      ...order,
      timestamp: serverTimestamp(),
      specialtyOnly: Object.keys(order.categories).length === 1 && order.categories["Specialty"] !== undefined,
    };
    await addDoc(collection(db, "orders"), newOrder).then((docRef) => {
      if (order.categories["Specialty"] !== undefined) {
        const specialty = {
          number: order.number,
          notes: order.notes,
          done: false,
          timestamp: serverTimestamp(),
          items: order.categories.Specialty.items,
        };
        setDoc(doc(db, "specialty", docRef.id), specialty);
      }
    });
  };

  if (loading) {
    return <div>Loading menu...</div>; // todo replace with spinner
  }

  return (
    <Tabs defaultValue="cashier" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="cashier">Cashier</Tabs.Tab>
        <Tabs.Tab value="activeOrders">Food/Drink</Tabs.Tab>
        <Tabs.Tab value="server">Servers</Tabs.Tab>
        <Tabs.Tab value="specialty">Specialty</Tabs.Tab>
        <Tabs.Tab value="editMenu">Edit Menu</Tabs.Tab>
        <Tabs.Tab value="allOrders">All Orders</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="cashier">
        <CashierPage menu={menu} submitOrder={submitOrder} />
      </Tabs.Panel>
      <Tabs.Panel value="activeOrders">
        <OrderPage />
      </Tabs.Panel>
      <Tabs.Panel value="server">
        <ServerPage />
      </Tabs.Panel>
      <Tabs.Panel value="allOrders">
        <AllOrdersPage menu={menu} />
      </Tabs.Panel>
      <Tabs.Panel value="editMenu">
        <EditMenuPage menu={menu} />
      </Tabs.Panel>
      <Tabs.Panel value="specialty">
        <SpecialtyPage />
      </Tabs.Panel>
    </Tabs>
  );
}

export default App;
