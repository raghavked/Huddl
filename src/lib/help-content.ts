/**
 * "How Hearth works" as structured data for the /help page.
 *
 * NOTE ON DUPLICATION: the native app is the source of truth for this copy,
 * at mobile/src/lib/help-content.ts, but the web tsconfig cannot import from
 * mobile/, so the strings are duplicated here verbatim. Change one and change
 * the other, exactly as the legal documents work.
 */

/** One thing a student can do, and the one line that explains it. */
export type HelpItem = {
  /** Sentence case, no trailing period. The name they will look for. */
  term: string;
  /** One sentence. Concrete, and true of the shipped app. */
  detail: string;
};

/** A run of related items under a heading. */
export type HelpSection = {
  /** Stable identity, safe as a React key and as a web anchor. */
  key: string;
  /** Two or three words. Sentence case. */
  title: string;
  /** Optional line under the heading, when the group needs framing. */
  intro?: string;
  items: HelpItem[];
};

export const HELP_INTRO =
  "Hearth is your campus in one app: the people in your classes, the ones " +
  "running clubs, and everything the two of you might want to do this week. " +
  "Here is where everything lives.";

export const HELP_SECTIONS: HelpSection[] = [
  {
    key: "tabs",
    title: "The five tabs",
    intro:
      "They sit along the bottom of every screen, so nothing is more than a tap away.",
    items: [
      {
        term: "Home",
        detail:
          "What is due, who is around and what is on, pulled together for today.",
      },
      {
        term: "Rooms",
        detail:
          "One per class you are taking, plus the campus-wide ones and any your classmates start.",
      },
      {
        term: "Messages",
        detail: "Direct messages, one to one or with a group you pick.",
      },
      {
        term: "Clubs",
        detail:
          "Societies and teams, their announcements and their events. A club is open, so anyone on campus can join, or invite only, where an officer sends you an invitation and you accept it from the club page.",
      },
      {
        term: "Events",
        detail:
          "Study sessions and meetups, planned by students rather than an admin.",
      },
    ],
  },
  {
    key: "classes",
    title: "Your classes",
    intro:
      "Add a course and a lot arrives with it. Everything here is per class.",
    items: [
      {
        term: "The class chat",
        detail:
          "A room with the rest of your section in it, created the moment you add the course.",
      },
      {
        term: "A shared calendar",
        detail:
          "Deadlines the whole class can see. Paste your syllabus and the dates fill themselves in.",
      },
      {
        term: "Notes and decks",
        detail:
          "Upload your notes, read everyone else's, and study from flashcard decks the class builds.",
      },
      {
        term: "Grades",
        detail:
          "What you have back so far, and what it adds up to. Only you can see this.",
      },
      {
        term: "Study buddies",
        detail:
          "Classmates who said they want a partner. Tap one to start a message.",
      },
    ],
  },
  {
    key: "people",
    title: "Finding people",
    items: [
      {
        term: "Search",
        detail:
          "One box for people, rooms, courses and events. It is on Home.",
      },
      {
        term: "The people directory",
        detail:
          "Everyone at your school. Search it by name, major, year or handle, or tap an interest to narrow it down.",
      },
      {
        term: "Profiles",
        detail:
          "A photo, a line about them, what they are looking for, and the classes you have in common.",
      },
      {
        term: "Focus",
        detail:
          "Say you are sitting down to work and see who else is. Your name and your class show up to your campus for as long as the timer runs, and you can set it to just you instead.",
      },
    ],
  },
  {
    key: "privacy",
    title: "Who can see what",
    intro: "The short version, with the full detail in the privacy policy.",
    items: [
      {
        term: "Everyone here goes to your school",
        detail:
          "An account needs a working school email address, so you are talking to classmates.",
      },
      {
        term: "The verified badge",
        detail:
          "You get it once your email is confirmed and your profile is filled in: a real name, a photo, your major and your year.",
      },
      {
        term: "Turning off Public profile",
        detail:
          "In Account. Classmates then see only your handle and your photo, not your name, major, year or bio. You stay listed in the people directory either way.",
      },
      {
        term: "Blocking",
        detail:
          "Long-press anyone and block them. Their messages disappear for you, and they are never told.",
      },
    ],
  },
  {
    key: "trouble",
    title: "If something goes wrong",
    items: [
      {
        term: "Report a message or a person",
        detail:
          "Long-press it and choose Report. It goes to the moderators at your school, not to a call centre.",
      },
      {
        term: "See what you reported",
        detail:
          "Settings has a list of the reports you have filed and where each one got to.",
      },
      {
        term: "Take your data with you",
        detail:
          "Settings can export everything you have written, and delete the account for good.",
      },
    ],
  },
];
