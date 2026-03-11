import orjson
import os
import sys
import time


def merge_entries(data1, data2):

    # append entries in data2 that are not in data1 by ip
    uniqueItems = find_unique_ips(data1, data2)

    if count_duplicates(data1):
        print("FOUND DUPLICATES IN FIRST DATA, EXITING")
        return
    if count_duplicates(data2):
        print("FOUND DUPLICATES IN SECOND DATA, EXITING")
        return

    data1.append(uniqueItems)
    print(len(data1))

    ## TODO - merge unique trace data into the ips

    json_bytes = orjson.dumps({"geo_cache": data1})
    # Define the file path
    file_path = f"../../permDatabase/log_{time.strftime('%m-%d_%H-%M')}MERGED.json"
    # Open the file in write-binary mode and write the bytes
    try:
        with open(file_path, "wb") as f:
            f.write(json_bytes)
        print(f"Data successfully saved to {os.path.abspath(file_path)}")
    except IOError as e:
        print(f"An error occurred while writing to the file: {e}")


def count_similar_entries(data1, data2):
    for idx1, item1 in enumerate(data1):
        for idx2, item2 in enumerate(data2):
            if item1["ip"] == item2["ip"]:
                print(
                    "found similar | "
                    + item1["ip"]
                    + "At Index: "
                    + str(idx1)
                    + " | "
                    + item2["ip"]
                    + "At Index: "
                    + str(idx2)
                )


def find_unique_ips(data1, data2):
    uniqueEntries = []

    for item2 in data2:
        if item2 not in data1:
            uniqueEntries.append(item2)

    print(len(uniqueEntries))
    return uniqueEntries


def count_duplicates(data):
    duplicate_found = False
    for idx1, item1 in enumerate(data):
        for idx2, item2 in enumerate(data):
            if item1["ip"] == item2["ip"] and idx1 != idx2:
                duplicate_found = True
                print(
                    "Duplicate Found | "
                    + item1["ip"]
                    + "At Index: "
                    + str(idx1)
                    + " | "
                    + item2["ip"]
                    + "At Index: "
                    + str(idx2)
                )
    not duplicate_found and print("No duplicates found!")


def get_avg2(num1, num2):
    return (num1 + num2) / 2


def main():
    if len(sys.argv) == 3:
        file1 = sys.argv[1]
        file2 = sys.argv[2]
        print(f"Processing files: {file1} and {file2}")

        try:
            with open(file1, "rb") as f:
                file1Bytes = f.read()
            file1Data = orjson.loads(file1Bytes)

            with open(file2, "rb") as f:
                file2Bytes = f.read()

            file2Data = orjson.loads(file2Bytes)

            # You can now work with the Python data
            # print(orjson.dumps(file1Data, option=orjson.OPT_INDENT_2).decode("utf-8"))
            # print(orjson.dumps(file2Data, option=orjson.OPT_INDENT_2).decode("utf-8"))

            print("Successfully imported data:")
            # print("file1 geo_cache length:", len(file1Data["geo_cache"]))
            # print("file2 geo_cache length:", len(file2Data["geo_cache"]))

            # # count_similar_entries(file1Data, file2Data)
            # count_duplicates(file1Data)
            # count_duplicates(file2Data)

            # merge_entries(1, 1)

            merge_entries(file1Data["geo_cache"], file2Data["geo_cache"])

            # find_unique_ips(file1Data["geo_cache"],file2Data["geo_cache"])

        except FileNotFoundError:
            print(f"Error: The file '{file1}' was not found.")
        except orjson.JSONDecodeError as e:
            print(f"Error decoding JSON: {e}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
    else:
        print(
            "Please provide 2 arguments, location to first file and location to second file"
        )


if __name__ == "__main__":
    main()
