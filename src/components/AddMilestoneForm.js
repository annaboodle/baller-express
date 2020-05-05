import React from "react";

export default function AddMilestoneForm({
  onSubmit,
  addEventType,
  updateAddEventType,
  addEventDate,
  updateAddEventDate,
  addEventPrecise,
  updateAddEventPrecise,
  addEventDesc,
  updateAddEventDesc,
  addEventCheckboxes,
  addEventOtherPeople,
  updateAddEventOtherPeople,
  createStringOfAllPeopleInAddEvent,
}) {
  return (
    <form
      className="form"
      action="https://docs.google.com/forms/u/1/d/e/1FAIpQLSfUF2D2Yh3tJgiAa4tUAjNqnzfFBiKeGe9MdibIehRlPSD4Kw/formResponse"
      method="post"
      target="hidden_iframe"
      onSubmit={() => {
        "submitted=true;";
        onSubmit();
      }}
    >
      <h2 className="form-title">Add a milestone</h2>
      <p className="form-label">What type of milestone is it?</p>
      <div className="form-field form-field--radio">
        <label className="radio-container">
          event
          <input
            name="entry.465797031"
            type="radio"
            value="event"
            checked={addEventType === "event" ? true : false}
            onChange={(e) => {
              if (e.target.checked) {
                updateAddEventType("event");
              }
            }}
          />
          <span className="checkmark" />
        </label>
      </div>
      <div className="form-field form-field--radio">
        <label className="radio-container">
          intro
          <input
            name="entry.465797031"
            type="radio"
            value="intro"
            checked={addEventType === "intro" ? true : false}
            onChange={(e) => {
              if (e.target.checked) {
                updateAddEventType("intro");
              }
            }}
          />
          <span className="checkmark" />
        </label>
      </div>
      <div className="form-field form-field--radio">
        <label className="radio-container">
          move
          <input
            name="entry.465797031"
            type="radio"
            value="move"
            checked={addEventType === "move" ? true : false}
            onChange={(e) => {
              if (e.target.checked) {
                updateAddEventType("move");
              }
            }}
          />
          <span className="checkmark" />
        </label>
      </div>
      <div className="form-field form-field--radio">
        <label className="radio-container">
          trip
          <input
            name="entry.465797031"
            type="radio"
            value="trip"
            checked={addEventType === "trip" ? true : false}
            onChange={(e) => {
              if (e.target.checked) {
                updateAddEventType("trip");
              }
            }}
          />
          <span className="checkmark" />
        </label>
      </div>

      {/* date - first one is to use date picker, doesn't submit */}
      <div className="form-flex form-flex-date">
        <div className="form-field">
          <label className="form-label">When did it happen?</label>
          <p className="form-help">
            Please enter a full date, even if you're not 100% sure.
          </p>
          <input
            onChange={(e) => {
              updateAddEventDate(e.target.value);
            }}
            type="date"
            value={addEventDate}
          />
        </div>

        {/* precise */}
        <div className="form-field form-field--checkbox form-field--checkbox-date">
          <label className="checkbox-container">
            This date isn't exact, but it's close!
            <input
              type="checkbox"
              onChange={(e) => {
                updateAddEventPrecise(e.target.checked);
              }}
              checked={addEventPrecise}
            />
            <span className="checkmark" />
          </label>
        </div>
      </div>

      {/* actually submits the date */}
      <div className="form-field hide">
        <label className="form-label">date</label>
        <input
          readOnly
          type="text"
          name="entry.1572580151"
          value={`${addEventDate.split("-")[1]}/${addEventDate.split("-")[2]}/${
            addEventDate.split("-")[0]
          }`}
        />
      </div>

      {/* actually submits precise */}
      <div className="form-field hide">
        <label className="form-label">precise</label>
        <input
          readOnly
          type="text"
          name="entry.818650547"
          value={addEventPrecise ? "N" : "Y"}
        />
      </div>

      {/* event */}
      <div className="form-field">
        <label className="form-label">What happened?</label>
        <p className="form-help">
          This will be the milestone description. Everything you include will be
          visible on the timeline!
        </p>
        <textarea
          onChange={(e) => {
            updateAddEventDesc(e.target.value);
          }}
          value={addEventDesc}
          name="entry.2083246933"
        />
      </div>

      {/* people */}
      <p className="form-label">Who was involved?</p>
      <div className="form-field--checkbox-wrap">
        {addEventCheckboxes}
        {/* {checkboxesForPeopleInAddMilestone} */}
      </div>

      <div className="form-field">
        <label className="form-label">Anyone else?</label>
        <p className="form-help">Separate each name by a comma.</p>
        <input
          onChange={(e) => {
            updateAddEventOtherPeople(e.target.value);
          }}
          value={addEventOtherPeople}
          type="text"
        />
      </div>

      {/* hidden field submitting all people */}
      <div className="form-field hide">
        <label className="form-label">people</label>
        <input
          readOnly
          value={createStringOfAllPeopleInAddEvent()}
          name="entry.210962264"
          type="text"
        />
      </div>

      <div className="form-flex">
        {/* name */}
        <div className="form-field">
          <label className="form-label">Your name</label>
          <input name="entry.2022364556" type="text" />
        </div>
        {/* email */}
        <div className="form-field">
          <label className="form-label">Your email</label>
          <input name="entry.2051201691" type="email" />
        </div>
      </div>

      {/* hide */}
      <div className="hide">
        <div className="form-field">
          <label>hide</label>
          <input readOnly value="N" type="text" name="entry.1603008717" />
        </div>
      </div>

      <p>
        Once you submit, your milestone will be immediately added to the
        timeline. Make sure it looks good!!!
      </p>
      <input type="submit" value="Submit" />
    </form>
  );
}
