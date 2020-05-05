import React from "react";

export default function SubmitEditForm({
  onSubmit,
  milestoneDateToSubmit,
  dateCheck,
  updateDateCheck,
  milestonePeopleToSubmit,
  peopleCheck,
  updatePeopleCheck,
  milestoneDescToSubmit,
  descCheck,
  updateDescCheck,
  editEventDesc,
  updateEditEventDesc,
}) {
  return (
    <form
      className="form"
      action="https://docs.google.com/forms/u/1/d/e/1FAIpQLSe8ZGjkYfwGaKkZZvqIzzJ23fkaQjVy4rH3tVbhC5zjHUN1Gw/formResponse"
      method="post"
      target="hidden_iframe"
      onSubmit={() => {
        "submitted=true;";
        onSubmit();
        // updateEditModalOpen(false).then(clearEditFormFields());
      }}
    >
      <h2 className="form-title">Submit edits to this milestone</h2>

      <div className="form-field--checkbox-wrap">
        <p className="form-label">What needs to be edited?</p>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-label">The date of the milestone: </span>
            <span className="submit-data">{milestoneDateToSubmit}</span>
            <input
              name="entry.1414516352"
              type="checkbox"
              value="The date of the milestone"
              checked={dateCheck}
              onChange={(e) => {
                updateDateCheck(e.target.checked);
              }}
            />
            <span className="checkmark" />
          </label>
        </div>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-label">The people involved: </span>
            <span className="submit-data">{milestonePeopleToSubmit}</span>
            <input
              name="entry.1414516352"
              type="checkbox"
              value="The people involved"
              checked={peopleCheck}
              onChange={(e) => {
                updatePeopleCheck(e.target.checked);
              }}
            />
            <span className="checkmark" />
          </label>
        </div>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-label">The description: </span>
            <span className="submit-data">{milestoneDescToSubmit}</span>
            <input
              name="entry.1414516352"
              type="checkbox"
              value="The description"
              checked={descCheck}
              onChange={(e) => {
                updateDescCheck(e.target.checked);
              }}
            />
            <span className="checkmark" />
          </label>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">What needs to be updated?</label>
        <textarea
          name="entry.1629872213"
          type="text"
          value={editEventDesc}
          onChange={(e) => {
            updateEditEventDesc(e.target.value);
          }}
        />
      </div>

      <div className="form-flex">
        <div className="form-field">
          <label className="form-label">Your name</label>
          <input name="entry.867338912" type="text" />
        </div>
        <div className="form-field">
          <label className="form-label">Your email</label>
          <input name="entry.1913191690" type="email" />
        </div>
      </div>

      {/* stuff to prepopulate */}
      <div className="hide">
        <div className="form-field">
          <label>milestone date</label>
          <input
            readOnly
            name="entry.198487940"
            type="text"
            value={milestoneDateToSubmit}
          />
        </div>
        <div className="form-field">
          <label>milestone description</label>
          <input
            readOnly
            name="entry.1640389616"
            type="text"
            value={milestoneDescToSubmit}
          />
        </div>
        <div className="form-field">
          <label>milestone people</label>
          <input
            readOnly
            name="entry.635908298"
            type="text"
            value={milestonePeopleToSubmit}
          />
        </div>
      </div>

      <input type="submit" value="Submit" />
    </form>
  );
}
