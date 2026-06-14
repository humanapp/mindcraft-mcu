#include "core/runtime/managed-heap.h"

#include <cstring>

namespace mindcraft {
namespace {

/**
 * SameValueZero equality at the profile precision: NaN equals NaN (so NaN is a
 * usable key) and +0 equals -0 (one key). Mirrors the TS `Dict` number-key
 * semantics.
 */
bool sameValueZero(mc_number_t a, mc_number_t b) { return a == b || (a != a && b != b); }

/**
 * Map-key equality: number keys by SameValueZero; string keys by constant-pool
 * index. Borrowed string keys are deduplicated upstream, so equal content
 * always shares one index and identity reduces to an index compare.
 */
bool keyEqual(const MapKey& a, const MapKey& b) {
  if (a.isNumber != b.isNumber) {
    return false;
  }
  if (a.isNumber) {
    return sameValueZero(a.number, b.number);
  }
  return a.stringIndex == b.stringIndex;
}

} // namespace

uint32_t SlabAllocator::orderForBytes(size_t bytes) {
  uint32_t order = kMinOrder;
  while ((static_cast<size_t>(1) << order) < bytes && order < 62) {
    order++;
  }
  return order;
}

void* SlabAllocator::allocate(size_t bytes) {
  if (bytes == 0) {
    return nullptr;
  }
  const uint32_t order = orderForBytes(bytes);
  if (order > kMaxOrder) {
    return nullptr;
  }
  if (bins_[order] != nullptr) {
    void* block = bins_[order];
    void* next = nullptr;
    memcpy(&next, block, sizeof(void*));
    bins_[order] = next;
    return block;
  }
  return arena_.allocateBytes(static_cast<size_t>(1) << order, alignof(MapEntry));
}

void SlabAllocator::release(void* block, size_t bytes) {
  if (block == nullptr || bytes == 0) {
    return;
  }
  const uint32_t order = orderForBytes(bytes);
  if (order > kMaxOrder) {
    return;
  }
  memcpy(block, &bins_[order], sizeof(void*));
  bins_[order] = block;
}

ManagedHeap::ManagedHeap(RegionArena& arena)
    : base_(arena.base()), slabs_(arena), lists_(arena), maps_(arena) {}

ListObject* ManagedHeap::allocListObject(GcRoots* roots) {
  ListObject* obj = lists_.alloc();
  if (obj == nullptr && roots != nullptr) {
    collect(*roots);
    obj = lists_.alloc();
  }
  return obj;
}

MapObject* ManagedHeap::allocMapObject(GcRoots* roots) {
  MapObject* obj = maps_.alloc();
  if (obj == nullptr && roots != nullptr) {
    collect(*roots);
    obj = maps_.alloc();
  }
  return obj;
}

bool ManagedHeap::newList(uint32_t typeId, GcRoots* roots, Value& out) {
  ListObject* obj = allocListObject(roots);
  if (obj == nullptr) {
    return false;
  }
  obj->items = nullptr;
  obj->size = 0;
  obj->capacity = 0;
  obj->mark = false;
  out = Value::list(typeId, handleOf(obj));
  return true;
}

bool ManagedHeap::newMap(uint32_t typeId, GcRoots* roots, Value& out) {
  MapObject* obj = allocMapObject(roots);
  if (obj == nullptr) {
    return false;
  }
  obj->entries = nullptr;
  obj->size = 0;
  obj->capacity = 0;
  obj->mark = false;
  out = Value::map(typeId, handleOf(obj));
  return true;
}

ListObject* ManagedHeap::list(const Value& value) const {
  return static_cast<ListObject*>(fromHandle(value.containerHandle()));
}

MapObject* ManagedHeap::map(const Value& value) const {
  return static_cast<MapObject*>(fromHandle(value.containerHandle()));
}

bool ManagedHeap::listEnsureCapacity(ListObject* obj, uint32_t needed, GcRoots* roots) {
  if (needed <= obj->capacity) {
    return true;
  }
  uint32_t newCap = obj->capacity == 0 ? 2 : obj->capacity;
  while (newCap < needed) {
    newCap *= 2;
  }
  const size_t bytes = static_cast<size_t>(newCap) * sizeof(Value);
  void* block = slabs_.allocate(bytes);
  if (block == nullptr && roots != nullptr) {
    collect(*roots);
    block = slabs_.allocate(bytes);
  }
  if (block == nullptr) {
    return false;
  }
  Value* items = static_cast<Value*>(block);
  for (uint32_t i = 0; i < obj->size; i++) {
    items[i] = obj->items[i];
  }
  if (obj->items != nullptr) {
    slabs_.release(obj->items, static_cast<size_t>(obj->capacity) * sizeof(Value));
  }
  obj->items = items;
  obj->capacity = newCap;
  return true;
}

bool ManagedHeap::listPush(ListObject* obj, const Value& item, GcRoots* roots) {
  if (!listEnsureCapacity(obj, obj->size + 1, roots)) {
    return false;
  }
  obj->items[obj->size++] = item;
  return true;
}

Value ManagedHeap::listGet(const ListObject* obj, int32_t index) const {
  if (index < 0 || static_cast<uint32_t>(index) >= obj->size) {
    return kNilValue;
  }
  return obj->items[static_cast<uint32_t>(index)];
}

void ManagedHeap::listSet(ListObject* obj, int32_t index, const Value& value) {
  if (index >= 0 && static_cast<uint32_t>(index) < obj->size) {
    obj->items[static_cast<uint32_t>(index)] = value;
  }
}

Value ManagedHeap::listPop(ListObject* obj) {
  if (obj->size == 0) {
    return kNilValue;
  }
  return obj->items[--obj->size];
}

Value ManagedHeap::listShift(ListObject* obj) {
  if (obj->size == 0) {
    return kNilValue;
  }
  const Value head = obj->items[0];
  for (uint32_t i = 1; i < obj->size; i++) {
    obj->items[i - 1] = obj->items[i];
  }
  obj->size--;
  return head;
}

Value ManagedHeap::listRemove(ListObject* obj, int32_t index) {
  if (index < 0 || static_cast<uint32_t>(index) >= obj->size) {
    return kNilValue;
  }
  const uint32_t i = static_cast<uint32_t>(index);
  const Value removed = obj->items[i];
  for (uint32_t k = i + 1; k < obj->size; k++) {
    obj->items[k - 1] = obj->items[k];
  }
  obj->size--;
  return removed;
}

bool ManagedHeap::listInsert(ListObject* obj, int32_t index, const Value& value, GcRoots* roots) {
  uint32_t i = index < 0 ? 0 : static_cast<uint32_t>(index);
  if (i > obj->size) {
    i = obj->size;
  }
  if (!listEnsureCapacity(obj, obj->size + 1, roots)) {
    return false;
  }
  for (uint32_t k = obj->size; k > i; k--) {
    obj->items[k] = obj->items[k - 1];
  }
  obj->items[i] = value;
  obj->size++;
  return true;
}

void ManagedHeap::listSwap(ListObject* obj, int32_t i, int32_t j) {
  if (i >= 0 && static_cast<uint32_t>(i) < obj->size && j >= 0 &&
      static_cast<uint32_t>(j) < obj->size) {
    const Value tmp = obj->items[static_cast<uint32_t>(i)];
    obj->items[static_cast<uint32_t>(i)] = obj->items[static_cast<uint32_t>(j)];
    obj->items[static_cast<uint32_t>(j)] = tmp;
  }
}

bool ManagedHeap::mapEnsureCapacity(MapObject* obj, uint32_t needed, GcRoots* roots) {
  if (needed <= obj->capacity) {
    return true;
  }
  uint32_t newCap = obj->capacity == 0 ? 2 : obj->capacity;
  while (newCap < needed) {
    newCap *= 2;
  }
  const size_t bytes = static_cast<size_t>(newCap) * sizeof(MapEntry);
  void* block = slabs_.allocate(bytes);
  if (block == nullptr && roots != nullptr) {
    collect(*roots);
    block = slabs_.allocate(bytes);
  }
  if (block == nullptr) {
    return false;
  }
  MapEntry* entries = static_cast<MapEntry*>(block);
  for (uint32_t i = 0; i < obj->size; i++) {
    entries[i] = obj->entries[i];
  }
  if (obj->entries != nullptr) {
    slabs_.release(obj->entries, static_cast<size_t>(obj->capacity) * sizeof(MapEntry));
  }
  obj->entries = entries;
  obj->capacity = newCap;
  return true;
}

uint32_t ManagedHeap::mapFind(const MapObject* obj, const MapKey& key) const {
  for (uint32_t i = 0; i < obj->size; i++) {
    if (keyEqual(obj->entries[i].key, key)) {
      return i;
    }
  }
  return obj->size;
}

bool ManagedHeap::mapSet(MapObject* obj, const MapKey& key, const Value& value, GcRoots* roots) {
  const uint32_t found = mapFind(obj, key);
  if (found < obj->size) {
    obj->entries[found].value = value;
    return true;
  }
  if (!mapEnsureCapacity(obj, obj->size + 1, roots)) {
    return false;
  }
  obj->entries[obj->size].key = key;
  obj->entries[obj->size].value = value;
  obj->size++;
  return true;
}

Value ManagedHeap::mapGet(const MapObject* obj, const MapKey& key) const {
  const uint32_t found = mapFind(obj, key);
  return found < obj->size ? obj->entries[found].value : kNilValue;
}

bool ManagedHeap::mapHas(const MapObject* obj, const MapKey& key) const {
  return mapFind(obj, key) < obj->size;
}

void ManagedHeap::mapDelete(MapObject* obj, const MapKey& key) {
  const uint32_t found = mapFind(obj, key);
  if (found >= obj->size) {
    return;
  }
  for (uint32_t k = found + 1; k < obj->size; k++) {
    obj->entries[k - 1] = obj->entries[k];
  }
  obj->size--;
}

void ManagedHeap::mark(const Value& value) {
  if (value.isList()) {
    ListObject* obj = list(value);
    if (!obj->mark) {
      obj->mark = true;
      for (uint32_t i = 0; i < obj->size; i++) {
        mark(obj->items[i]);
      }
    }
  } else if (value.isMap()) {
    MapObject* obj = map(value);
    if (!obj->mark) {
      obj->mark = true;
      // String keys are borrowed and number keys carry no heap, so only values
      // need tracing.
      for (uint32_t i = 0; i < obj->size; i++) {
        mark(obj->entries[i].value);
      }
    }
  }
}

void ManagedHeap::collect(GcRoots& roots) {
  lists_.forEachLive([](ListObject& obj) { obj.mark = false; });
  maps_.forEachLive([](MapObject& obj) { obj.mark = false; });

  roots.enumerateRoots(*this);

  lists_.forEachLive([this](ListObject& obj) {
    if (!obj.mark) {
      if (obj.items != nullptr) {
        slabs_.release(obj.items, static_cast<size_t>(obj.capacity) * sizeof(Value));
      }
      lists_.free(&obj);
    }
  });
  maps_.forEachLive([this](MapObject& obj) {
    if (!obj.mark) {
      if (obj.entries != nullptr) {
        slabs_.release(obj.entries, static_cast<size_t>(obj.capacity) * sizeof(MapEntry));
      }
      maps_.free(&obj);
    }
  });
}

} // namespace mindcraft
