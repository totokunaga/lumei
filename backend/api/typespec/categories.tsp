import "@typespec/http";
import "@typespec/openapi";
import "./errors.tsp";

using Http;
using OpenAPI;

namespace Lumei;

/** A text in every language the app supports (BR-SET-01). */
model LocalizedText {
  @example("Eat Out") en: string;
  @example("外食") ja: string;
  @example("Restaurant") fr: string;
}

/** A category a new account starts with (BR-CAT-01). */
model DefaultCategory {
  /**
   * Identifies the category across languages and sets, e.g. `eat_out`. The app
   * derives the new category's ID from it.
   */
  @example("eat_out") key: string;

  @example("🍔") emoji: string;

  /** The name in each language. Setup uses the app's language (BR-CAT-06). */
  name: LocalizedText;
}

/** The default categories of one region (BR-CAT-07). */
model CategorySet {
  /**
   * The region, e.g. `jp`. `global` is the set for every region without its
   * own, offered at setup as "Other" (BR-SET-06).
   */
  @example("jp") region: string;

  /** The region's name in each language, as shown at setup. */
  name: LocalizedText;

  /**
   * ISO 3166-1 alpha-2 codes of the device regions that preselect this set
   * at setup, e.g. every EU member state for `eu`. Empty for `global`.
   */
  @example(#["JP"]) countries: string[];

  /** The categories, in display order. */
  categories: DefaultCategory[];
}

/** Every default category set, in the order setup lists the regions. */
model CategorySetList {
  sets: CategorySet[];
}

/** The default category sets. */
model CategorySetsOk {
  @statusCode statusCode: 200;
  @body body: CategorySetList;
}

@tag("categories")
interface Categories {
  /**
   * Returns the default category sets from the seed data, so a region or a
   * set can change without an app update (BR-CAT-07). Setup lists the regions
   * and copies the chosen set into the user's categories (BR-CAT-01).
   */
  @summary("List the default category sets")
  @operationId("listCategorySets")
  @useAuth(BearerAuth)
  @get
  @route("/category-sets")
  listCategorySets(): CategorySetsOk | Unauthorized;
}
