
/**
 * Sets up event listeners that show/hide elements on click, based on a
 * selector stored in a data attribute.
 */
export default function init(showButtonSelector, hideButtonSelector) {
  $(showButtonSelector).click((event) => {
    const showElementSelector = $(event.target).attr("data-show-selector");
    $(showElementSelector).show();
  });
  $(hideButtonSelector).click((event) => {
    const hideElementSelector = $(event.target).attr("data-hide-selector");
    $(hideElementSelector).hide();
  });
}
