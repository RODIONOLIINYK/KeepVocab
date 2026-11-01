# Meaning-category annotation policy v2

Frozen before new model training. This is a project evidence taxonomy, not an
objective universal linguistic ontology. Categories overlap. Annotate the exact
selected definition, never the model prediction, bare spelling, POS alone, or
incidental contents of a likely photo. Labels are AI authored/reviewed; semantic
accuracy has not been independently established by human experts.

## Six independent memberships

- **entity:** the referent is a physical organism, person, object, substance,
  material, artifact or built structure/component. Named substances remain
  entities even if a still photo cannot verify composition. A property adjective
  is not an entity just because it names a material: wood is entity, wooden state.
- **place:** the referent itself is a spatial setting, room, geographical area,
  terrain/landform, occupiable building or route. Mere location does not make an
  object a place. An occupiable constructed building or constructed route has
  entity+place: greenhouse, gazebo, warehouse, bridge, causeway. A room or natural
  landform is place without automatically adding entity. A roof component or
  freestanding object/barrier is entity without place: cupola, statue, wall,
  fence, breakwater. A constructed terrain feature, such as a levee defined as a
  raised bank, can have entity+place. Evaluate the definition's referent, not a
  vague assumption that every visible thing occupies space.
- **action:** an ongoing physical activity, motion, interaction, changing
  process or physical event. Events can be nouns and need no human actor.
  Shatter, splinter, evaporate, solidify, corrode and inflate are actions.
  **Do not add state merely because a process has a lasting visible result.**
  Conceptual/mental verbs do not automatically count as physical actions.
- **state:** physical appearance, material property, condition, sustained posture,
  facial expression or physiological resting condition. Verb forms can be
  stative: sleep, stand, sit, smile, hibernate. Adjectival participles that describe
  the current result are state (broken, frozen); an explicitly ongoing process is
  action. Both require two independently meaningful routes in the definition,
  such as active bubbling and an explicitly bubbly condition, not an implied
  endpoint. Private feelings/beliefs are abstract unless the selected definition
  is specifically their visible expression or bodily manifestation.
- **relation:** a meaning-defining relative configuration, contact, support,
  containment, connection, transfer, social role, comparison, or temporal/causal/
  conditional relationship with another referent. Bridges/causeways crossing
  obstacles, a cellar below ground, a mezzanine between floors and a cloister
  around a courtyard require this route. Do not add relation merely because an
  action is transitive, uses a tool, has a typical habitat, or mentions objects.
  Joining/attaching/holding/carrying and directed transfer require an inter-object
  relation; undirected motion and material transformations need not. Mentioning
  a tool in a material-changing process does not by itself add relation; joining
  two parts does. Impacts explicitly defined as contact between bodies (punch,
  kick, collision) do have action+relation. Mere launch contact in jumping and
  a typical source location in harvesting do not. Grammatical function does not
  determine membership.
- **abstract:** conceptual, logical, social/legal, psychological, temporal,
  evaluative or quantitative meaning that requires interpretation beyond physical
  appearance. Uncertainty and invisible composition/history of a physical thing
  are not this category. Social-role nouns retain entity+relation+abstract;
  generic person is entity. Temporal/causal/conditional connectives normally have
  relation+abstract; a nonrelational judgment such as valid can be abstract only.

Generic domain-unspecified procedures, behavior and conceptual change are
abstract; do not add action just because an unspecified procedure could be
enacted physically. Teamwork/cooperation/leadership describe social coordination
and have relation+abstract unless the definition separately specifies a bodily
activity. A physical condition and cognitive readiness can coexist in one
definition (alertness: state+abstract) without representing incompatible senses.
Alternative depictions of the same physical referent (snow falling or lying)
are not by themselves incompatible conceptual senses. Physical fragility is
state; its invisibility in a photo does not automatically add abstract.

Named constructed operational complexes (airport, refinery, rail yard) can be
entity+place even when defined as a facility/site. Generic interior circulation
spaces (concourse, gallery) are place; constructed exterior routes are
entity+place. An excavated pit is constructed terrain (entity+place). An outdoor
growing site does not gain entity merely because equipment may be present.
Geographic roles/boundaries defined relative to other features (peninsula,
tributary, isthmus, foothill, courtyard, underground cave) add relation; generic
height, climate, habitat or historical formation does not. Core active natural
phenomena can combine place+action (waterfall, spring, geyser, rapids), unlike a
building's merely typical human use. Storage purpose alone does not make every
container relational; explicit defining placement/connection does. These are
declared project conventions, not claims of unique universal linguistic truth.

## Review, ambiguity and grouping

Record every old and new label plus the rule-based reason, including unchanged
reviews. Do not use validation/test errors to decide labels. Paraphrases inherit
their exact parent meaning's revised labels and retain their common group and
shared unit loss weight. A definition mixing incompatible senses must be flagged
for adjudication/quarantine; do not conceal disagreement by forcing all labels.

The original source files and benchmarks remain byte-for-byte intact. In this
new version, old evaluation meanings are retired, never reassigned to training.
Revised labels use a new policy identifier; their scores cannot be directly
compared with percentages under old labels on a different cohort. Fresh meanings
and connected families are partitioned before fitting; direct synonyms or
derivatives of old meanings inherit the protected old group. All models in a
comparison use identical meaning groups, inputs and targets.

All six probabilities are retained. Binary thresholds only support reporting;
they do not replace continuous routing inputs. Calibration quality and category
accuracy are separate outcomes. A new untouched confirmation cohort is scored
only after architecture, hyperparameters, calibration and thresholds are frozen.
