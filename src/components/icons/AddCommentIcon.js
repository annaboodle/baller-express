import React from "react";

export default function AddCommentIcon({ fill = "#000" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={fill}
      width="24px"
      height="24px"
    >
      <path d="M0 0h24v24H0V0z" fill="none" />
      <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM17 11h-4v4h-2v-4H7V9h4V5h2v4h4v2z" />
    </svg>
  );
}
