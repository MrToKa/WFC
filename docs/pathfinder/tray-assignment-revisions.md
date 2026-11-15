# Tray assignments across model revisions

After selecting a new model revision, choose **Discover project tray candidates**.
Previously assigned trays are recognised by persistent object identity before
the current network is collected. There is no need to select each unchanged
object again. Current tray purposes and routing permissions still apply.

The previous published preparation supplies the assigned roots' SDK external
identifiers and, where present, GUID and source-file properties. The current
model resolves these identifiers independently of dbIds and translated display
names such as `3D Solid` and `3D-Volumenkörper`. A GUID with a changed SDK external
identifier can still match uniquely within its source file.

A complete unique match is required for every root of one tray. Missing or
ambiguous objects stay unresolved for selection review; an incomplete property
search does not prove a match. Missing historical identity evidence cannot be
reconstructed from a numeric dbId. Existing assignments and historical captures
remain available as their original revision's evidence.

Recognising identity preserves the assignment, not the old geometry. Preparation
reads the new model's geometry and publishes a new network. A matching GUID does
not certify that the object is physically unchanged; revision geometry comparison
remains a separate operation.

Historical identities come from checksum-verified published captures with the
saved assignment's ownership decision and root list. The extracted identity cache
is bounded and keyed by immutable source references. Only a fresh write against
the current preparation scope can install the new model's root IDs.
