// Item pages: hide the comment-submit form behind a "show comment box"
// link. Returning early on missing nodes covers locked threads and
// logged-out views, where the form (and possibly the row) isn't there.

import { h } from "../dom.js";

export function setupCommentBoxToggle() {
	const addComment = document.querySelector(".fatitem tr:last-of-type");
	const commentForm = document.querySelector("form[action='comment']");
	if (!addComment || !commentForm) return;

	addComment.classList.add("hidden");

	const showLink = h("a", {
		href: "#",
		text: "show comment box",
	});
	const showRow = h("tr", { class: "showComment" }, [
		h("td", { colSpan: 2 }),
		h("td", {}, [showLink]),
	]);
	const toggle = (e) => {
		e.preventDefault();
		showRow.classList.toggle("hidden");
		addComment.classList.toggle("hidden");
	};
	showLink.addEventListener("click", toggle);

	const hideLink = h("a", {
		href: "#",
		class: "hideComment",
		text: "hide comment box",
		onclick: toggle,
	});

	addComment.parentNode.insertBefore(showRow, addComment);
	commentForm.append(hideLink);
}
