using System.ComponentModel;
using System.Reflection;

public static class EnumExtensions
{
    public static string GetDescription(this Enum value)
    {
        if (value == null) return string.Empty;

        string? enumName = value.ToString();
        if (string.IsNullOrEmpty(enumName)) return string.Empty;

        FieldInfo? field = value.GetType().GetField(value.ToString());
        if (field != null)
        {
            if (Attribute.GetCustomAttribute(field, typeof(DescriptionAttribute)) is DescriptionAttribute attribute)
            {
                return attribute.Description;
            }
        }

        return enumName;
    }
}