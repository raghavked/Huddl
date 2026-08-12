import Feather from "@expo/vector-icons/Feather";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Field } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/* Founding a club, the way the web does it: one insert into clubs — DB
   triggers then create the chat channel and seat the founder as owner. */

type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

const CATEGORIES: readonly ClubCategory[] = [
  "academic",
  "professional",
  "cultural",
  "sports",
  "social",
  "service",
  "other",
];

/** "academic" -> "Academic" — every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** "Chess & Go Club!" -> "chess-go-club" — same recipe as the web app. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

const PERKS: readonly { icon: FeatherName; text: string }[] = [
  {
    icon: "message-circle",
    text: "A chat channel just for members — created automatically",
  },
  {
    icon: "calendar",
    text: "An events board for meetings, socials and everything else",
  },
  {
    icon: "award",
    text: "A roster with you as the owner — promote officers any time",
  },
];

export default function NewClubScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClubCategory>("other");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = slugify(name);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/clubs");
  }, [router]);

  const handleFound = useCallback(async () => {
    if (!userId || pending) return;

    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setFormError("Give your club a name of at least 3 characters.");
      return;
    }
    if (trimmed.length > 60) {
      setFormError("Club names can be at most 60 characters.");
      return;
    }
    if (!slug) {
      setFormError("The name needs at least one letter or number.");
      return;
    }

    setFormError(null);
    setPending(true);

    // The club lives on your campus — grab it from your profile.
    const profileRes = await supabase
      .from("profiles")
      .select("university_id")
      .eq("id", userId)
      .single();
    if (profileRes.error) {
      setPending(false);
      setFormError("We couldn't reach your profile. Give it another try.");
      return;
    }
    const { university_id: universityId } = profileRes.data as unknown as {
      university_id: string;
    };

    // One insert — the DB creates the chat channel and makes you the owner.
    const insertRes = await supabase
      .from("clubs")
      .insert({
        university_id: universityId,
        created_by: userId,
        name: trimmed,
        slug,
        category,
        description: description.trim() || null,
      })
      .select("id")
      .single();
    if (insertRes.error || !insertRes.data) {
      setPending(false);
      setFormError(
        insertRes.error?.code === "23505"
          ? `"${trimmed}" is already taken at your school — try a more specific name.`
          : "Something went wrong founding the club. Give it another try."
      );
      return;
    }
    const clubId = (insertRes.data as unknown as { id: string }).id;

    router.replace(`/club/${clubId}`);
  }, [userId, pending, name, slug, category, description, router]);

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        <View style={{ paddingHorizontal: space.close }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="chevron-left" size={26} color={theme.foreground} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingBottom: insets.bottom + space.rest,
            gap: space.card,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: space.snug }}>
            <AppText variant="display">Start a club</AppText>
            <AppText variant="caption" muted>
              Your club, live in a minute. Here's what founding one gets you:
            </AppText>
          </View>

          <View style={{ gap: space.room }}>
            {PERKS.map((perk) => (
              <View
                key={perk.text}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.room,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.control,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name={perk.icon} size={16} color={theme.brand} />
                </View>
                <AppText variant="caption" style={{ flex: 1 }}>
                  {perk.text}
                </AppText>
              </View>
            ))}
          </View>

          <View style={{ gap: space.snug }}>
            <Field
              label="Club name"
              value={name}
              onChangeText={setName}
              placeholder="Astronomy Society"
              maxLength={60}
              editable={!pending}
            />
            <AppText variant="caption" muted>
              Chat channel: #club-{slug || "your-club"}
            </AppText>
          </View>

          <View style={{ gap: space.snug }}>
            <AppText variant="label">Category</AppText>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.cosy,
              }}
            >
              {CATEGORIES.map((option) => {
                const selected = category === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={categoryLabel(option)}
                    onPress={() => setCategory(option)}
                    disabled={pending}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: space.card,
                      paddingVertical: space.room,
                      borderRadius: radius.full,
                      backgroundColor: selected
                        ? theme.brandSoft
                        : theme.surface,
                      borderWidth: 1,
                      borderColor: selected ? theme.brandInk : theme.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <AppText
                      variant="label"
                      style={{
                        color: selected ? theme.brandInk : theme.muted,
                        fontSize: 13,
                      }}
                    >
                      {categoryLabel(option)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="What's your club about? Who should join?"
            maxLength={500}
            multiline
            editable={!pending}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />

          {formError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {formError}
            </AppText>
          ) : null}

          <Button
            label={pending ? "Founding…" : "Found this club"}
            pending={pending}
            icon={<Feather name="flag" size={16} color={theme.brandFg} />}
            onPress={() => void handleFound()}
            style={{ marginTop: space.tight }}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
